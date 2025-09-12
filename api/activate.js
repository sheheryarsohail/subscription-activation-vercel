// api/activate.js — resume + mark used, then redirect all users to a generic portal page
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const code  = String(req.query.code || "").trim();
    const subId = String(req.query.subId || "").trim();
    if (!code || !subId) return res.status(400).send("Missing code or subId");

    // 1) Lookup the code in Google Sheet via Apps Script
    if (!(process.env.GAS_URL && process.env.GAS_SECRET)) {
      return res.status(500).send("Storage not configured");
    }
    const lookupResp = await fetch(process.env.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "get", code })
    });
    const lookupTxt = await lookupResp.text();
    let data; try { data = JSON.parse(lookupTxt); } catch { return res.status(500).send("Lookup parse error"); }
    if (!data?.ok) return res.status(400).send("Invalid or unknown code");

    const sheetSubId = String(data.subscriptionId || "");
    const status     = String(data.status || "unused");
    if (sheetSubId !== subId) return res.status(400).send("Code does not match this subscription");
    if (status === "used")    return res.status(400).send("Code already used");

    // 2) Resume in Seal
    const sealResp = await fetch("https://app.sealsubscriptions.com/shopify/merchant/api/subscription", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Seal-Token": process.env.SEAL_API_KEY },
      body: JSON.stringify({ id: Number(subId), action: "resume" })
    });
    if (!sealResp.ok) {
      const txt = await sealResp.text();
      console.error("Seal resume failed:", txt);
      return res.status(502).send("Resume failed");
    }

    // 3) Mark used in Sheet (best effort)
    try {
      const mark = await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "mark_used", code, subscriptionId: subId })
      });
      const markTxt = await mark.text();
      let markJson; try { markJson = JSON.parse(markTxt); } catch {}
      if (!markJson?.ok) console.error("mark_used failed:", markTxt);
    } catch (e) {
      console.error("mark_used error:", e);
    }

    // 4) Redirect to generic portal page
    const target =
      process.env.PORTAL_REDIRECT_URL ||
      (process.env.SHOP_DOMAIN ? `https://${process.env.SHOP_DOMAIN}/a/subscriptions/manage` : null);

    if (!target) {
      // Fallback: minimal success page if no portal URL configured
      res.setHeader("Content-Type", "text/html; charset=utf-8");
      return res.status(200).send(`
        <div style="font-family:system-ui;margin:40px;max-width:560px;line-height:1.45">
          <h2>✅ Subscription activated</h2>
          <p>Your subscription has been resumed. Please visit your account to manage it.</p>
        </div>
      `);
    }

    res.setHeader("Location", target);
    return res.status(302).end();
  } catch (err) {
    console.error("activate error:", err);
    return res.status(500).send("Server error");
  }
}
