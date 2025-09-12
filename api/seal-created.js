// api/seal-created.js
import QRCode from "qrcode";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    // 1) Parse Seal webhook payload
    const payload =
      typeof req.body === "object" && req.body !== null
        ? req.body
        : JSON.parse(req.body || "{}");

    const subscriptionId = String(payload.id);
    const customerEmail  = payload.email || "";
    if (!subscriptionId) {
      return res.status(400).json({ ok: false, error: "Missing subscription id" });
    }

    // 2) Pause the subscription in Seal
    const pauseResp = await fetch("https://app.sealsubscriptions.com/shopify/merchant/api/subscription", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Seal-Token": process.env.SEAL_API_KEY
      },
      body: JSON.stringify({ id: Number(subscriptionId), action: "pause" })
    });

    if (!pauseResp.ok) {
      const txt = await pauseResp.text();
      console.error("Seal pause failed:", txt);
      // We won’t fail the whole request—just return info for debugging
    }

    // 3) Generate a one-time activation code + URL + QR
    const code = makeCode(12);
    const activateUrl = `${process.env.APP_URL.replace(/\/$/,"")}/api/activate?code=${encodeURIComponent(code)}&subId=${encodeURIComponent(subscriptionId)}`;
    const qrDataUrl = await QRCode.toDataURL(activateUrl);

    // 4) (Optional) Persist to Google Sheet if configured
    if (process.env.GAS_URL && process.env.GAS_SECRET) {
      await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.GAS_SECRET,
          op: "save",
          code,
          subscriptionId,
          status: "unused",
          customerEmail
        })
      });
    } else {
      // TEMP memory cache (will reset on cold start; ok for testing)
      const store = (globalThis.__codes ||= new Map());
      store.set(code, { subscriptionId, used: false, issuedAt: Date.now(), customerEmail });
    }

    // 5) Return values so you can see them in a test (Flow/Email can also use these)
    return res.status(200).json({ ok: true, code, activateUrl, qrDataUrl });
  } catch (err) {
    console.error("seal-created error:", err);
    return res.status(200).json({ ok: false, error: String(err) });
  }
}

function makeCode(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64url").slice(0, len).toUpperCase();
}
