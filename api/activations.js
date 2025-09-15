// api/activations.js
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });

    const q         = (req.query.q || "").trim().toLowerCase();
    const statusQ   = (req.query.status || "").toLowerCase(); // "used" | "unused" | ""
    const issuedFrom= (req.query.issuedFrom || "").trim();
    const issuedTo  = (req.query.issuedTo || "").trim();
    const usedFrom  = (req.query.usedFrom || "").trim();
    const usedTo    = (req.query.usedTo || "").trim();
    const limit     = Math.min(Number(req.query.limit || 500), 2000);

    if (!(process.env.GAS_URL && process.env.GAS_SECRET)) {
      return res.status(500).json({ ok: false, error: "Storage not configured" });
    }

    const gasResp = await fetch(process.env.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "list_recent" })
    });

    const text = await gasResp.text();
    let json;
    try { json = JSON.parse(text); } catch {
      return res.status(502).json({ ok: false, error: "GAS parse error", raw: text });
    }
    if (!json.ok) return res.status(502).json({ ok: false, error: "GAS error", detail: json });

    const itemsRaw = Array.isArray(json.rows) ? json.rows : [];

    const items = itemsRaw.map(r => ({
      row: r.row,
      code: String(r.code || ""),
      subscriptionId: String(r.subscriptionId || ""),
      status: (r.status || "").toLowerCase(), // used/unused
      issuedAt: r.issuedAt ?? null,
      usedAt: r.usedAt ?? null,
      customerEmail: String(r.customerEmail || ""),
      // optional, present in your sheet; safe to pass but we don't render the base64 in table
      qrUrl: r.qrUrl || "",
      activateUrl: r.activateUrl || ""
    }));

    // Helpers for date filtering (accept ISO yyyy-mm-dd or full datetime)
    const toDate = (v) => v ? new Date(v) : null;
    const inRange = (val, from, to) => {
      if (!val) return false;
      const d = new Date(val);
      if (isNaN(d)) return false;
      if (from && d < from) return false;
      if (to && d > to) return false;
      return true;
    };
    const iFrom = toDate(issuedFrom);
    const iTo   = toDate(issuedTo ? issuedTo + "T23:59:59" : ""); // inclusive day
    const uFrom = toDate(usedFrom);
    const uTo   = toDate(usedTo ? usedTo + "T23:59:59" : "");

    // Apply filters
    let filtered = items;

    if (q) {
      filtered = filtered.filter(x =>
        x.code.toLowerCase().includes(q) ||
        x.subscriptionId.toLowerCase().includes(q) ||
        x.customerEmail.toLowerCase().includes(q)
      );
    }
    if (statusQ === "used" || statusQ === "unused") {
      filtered = filtered.filter(x => x.status === statusQ);
    }
    if (issuedFrom || issuedTo) {
      filtered = filtered.filter(x => inRange(x.issuedAt, iFrom, iTo));
    }
    if (usedFrom || usedTo) {
      filtered = filtered.filter(x => inRange(x.usedAt, uFrom, uTo));
    }

    const total  = filtered.length;
    const used   = filtered.filter(x => x.status === "used").length;
    const unused = total - used;

    const itemsLimited = filtered.slice(0, limit);

    return res.status(200).json({
      ok: true,
      items: itemsLimited,
      totals: { total, used, unused },
      meta: { returned: itemsLimited.length, limit }
    });
  } catch (err) {
    console.error("activations API error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
