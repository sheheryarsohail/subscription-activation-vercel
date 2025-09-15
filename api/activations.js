// /api/activations.js
import { sql } from "@vercel/postgres";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const q         = (req.query.q || "").trim().toLowerCase();
    const statusQ   = (req.query.status || "").toLowerCase(); // "used" | "unused" | ""
    const issuedFrom= (req.query.issuedFrom || "").trim();
    const issuedTo  = (req.query.issuedTo || "").trim();
    const usedFrom  = (req.query.usedFrom || "").trim();
    const usedTo    = (req.query.usedTo || "").trim();
    const limit     = Math.min(Number(req.query.limit || 500), 2000);

    const where = [];
    const params = [];

    // --- Free-text search across code, subscriptionId, email
    if (q) {
      where.push(`(lower(code) like $${params.length + 1} or lower(subscription_id) like $${params.length + 2} or lower(customer_email) like $${params.length + 3})`);
      params.push(`%${q}%`, `%${q}%`, `%${q}%`);
    }

    // --- Status filter
    if (statusQ === "used" || statusQ === "unused") {
      where.push(`status = $${params.length + 1}`);
      params.push(statusQ);
    }

    // --- Issued date filters
    if (issuedFrom) {
      where.push(`issued_at >= $${params.length + 1}`);
      params.push(new Date(issuedFrom));
    }
    if (issuedTo) {
      where.push(`issued_at <= $${params.length + 1}`);
      params.push(new Date(issuedTo + "T23:59:59"));
    }

    // --- Used date filters
    if (usedFrom) {
      where.push(`(used_at is not null and used_at >= $${params.length + 1})`);
      params.push(new Date(usedFrom));
    }
    if (usedTo) {
      where.push(`(used_at is not null and used_at <= $${params.length + 1})`);
      params.push(new Date(usedTo + "T23:59:59"));
    }

    const whereSql = where.length ? "where " + where.join(" and ") : "";

    // --- Totals
    const totalsRes = await sql.query(
      `select
         count(*)::int as total,
         sum(case when status='used' then 1 else 0 end)::int as used
       from activation_codes ${whereSql}`,
      params
    );
    const total  = totalsRes.rows[0]?.total || 0;
    const used   = totalsRes.rows[0]?.used  || 0;
    const unused = total - used;

    // --- Items (list)
    const itemsRes = await sql.query(
      `select code, subscription_id, status, issued_at, used_at, customer_email
       from activation_codes
       ${whereSql}
       order by issued_at desc
       limit ${limit}`,
      params
    );

    const items = itemsRes.rows.map(r => ({
      code: r.code,
      subscriptionId: r.subscription_id,
      status: r.status,
      issuedAt: r.issued_at,
      usedAt: r.used_at,
      customerEmail: r.customer_email || ""
    }));

    return res.status(200).json({
      ok: true,
      items,
      totals: { total, used, unused },
      meta: { returned: items.length, limit }
    });
  } catch (err) {
    console.error("activations API error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
