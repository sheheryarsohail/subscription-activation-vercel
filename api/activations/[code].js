// api/activations/[code].js
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).json({ ok: false, error: "Method not allowed" });
    const code = String(req.query.code || "").trim();
    if (!code) return res.status(400).json({ ok: false, error: "Missing code" });

    if (!(process.env.GAS_URL && process.env.GAS_SECRET)) {
      return res.status(500).json({ ok: false, error: "Storage not configured" });
    }

    const gasResp = await fetch(process.env.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "get", code })
    });
    const txt = await gasResp.text();
    let data; try { data = JSON.parse(txt); } catch {
      return res.status(502).json({ ok: false, error: "GAS parse error", raw: txt });
    }
    if (!data?.ok) return res.status(404).json({ ok: false, error: "Not found" });

    // normalize
    const item = {
      code: String(data.code || ""),
      subscriptionId: String(data.subscriptionId || ""),
      status: (data.status || "").toLowerCase(),
      issuedAt: data.issuedAt ?? null,
      usedAt: data.usedAt ?? null,
      customerEmail: String(data.customerEmail || ""),
      qrUrl: data.qrUrl || "",
      activateUrl: data.activateUrl || ""
    };

    return res.status(200).json({ ok: true, item });
  } catch (err) {
    console.error("detail error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
