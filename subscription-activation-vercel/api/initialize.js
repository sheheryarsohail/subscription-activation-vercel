// api/initialize.js
import QRCode from "qrcode";

// ⚠️ TEMP in-memory store (resets on each cold start). For production use Vercel KV/Upstash/DB.
const memory = globalThis.__codes || (globalThis.__codes = new Map());

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const { subscriptionId, customerEmail } = req.body || {};
    if (!subscriptionId) {
      return res.status(400).json({ error: "subscriptionId is required" });
    }

    const SEAL_API_KEY = process.env.SEAL_API_KEY;
    const APP_URL = process.env.APP_URL;
    if (!SEAL_API_KEY || !APP_URL) {
      return res.status(500).json({ error: "Server env not configured (SEAL_API_KEY, APP_URL)" });
    }

    // 1) Pause subscription in Seal
    const pauseResp = await fetch(`https://api.sealsubscriptions.com/v1/subscriptions/${subscriptionId}/pause`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SEAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!pauseResp.ok) {
      const txt = await pauseResp.text();
      return res.status(502).json({ error: "Seal pause failed", details: txt });
    }

    // 2) Generate code + URL + QR
    const code = cryptoRandom(12);
    const activateUrl = `${APP_URL.replace(/\/$/, "")}/api/activate?code=${encodeURIComponent(code)}&subId=${encodeURIComponent(subscriptionId)}`;
    const qrDataUrl = await QRCode.toDataURL(activateUrl);

    // 3) Save to memory (replace with persistent store for production)
    memory.set(code, { subscriptionId, used: false, issuedAt: Date.now(), customerEmail });

    // 4) Return data to Flow/Klaviyo
    return res.status(200).json({ ok: true, code, activateUrl, qrDataUrl });
  } catch (err) {
    return res.status(500).json({ error: String(err) });
  }
}

function cryptoRandom(len = 12) {
  // URL-safe, uppercase
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64url").slice(0, len).toUpperCase();
}

// Node 18 has Web Crypto in globalThis
const { crypto } = globalThis;
