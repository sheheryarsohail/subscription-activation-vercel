// /api/activations/[code].js
import { sql } from "@vercel/postgres";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    const code = String(req.query.code || "").trim();
    if (!code) {
      return res.status(400).json({ ok: false, error: "Missing code" });
    }

    const { rows } = await sql`
      select code, subscription_id, status, issued_at, used_at, customer_email, qr_url, activate_url
      from activation_codes
      where code = ${code}
      limit 1;
    `;

    if (!rows.length) {
      return res.status(404).json({ ok: false, error: "Not found" });
    }

    const r = rows[0];
    const item = {
      code: r.code,
      subscriptionId: r.subscription_id,
      status: r.status,
      issuedAt: r.issued_at,
      usedAt: r.used_at,
      customerEmail: r.customer_email || "",
      qrUrl: r.qr_url || "",
      activateUrl: r.activate_url || ""
    };

    return res.status(200).json({ ok: true, item });
  } catch (err) {
    console.error("detail API error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
