// api/seal-created.js
import QRCode from "qrcode";
import { createHmac } from "node:crypto";

// small helper: safe, constant-time compare
function timingSafeEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// GAS save with retry + detailed result
async function saveToGAS(payload) {
  if (!(process.env.GAS_URL && process.env.GAS_SECRET)) {
    return { ok: false, error: "GAS not configured" };
  }

  const url = process.env.GAS_URL;
  const needsExec = !/\/exec(\?|$)/.test(url);
  if (needsExec) {
    return { ok: false, error: "GAS_URL must be the Web App /exec URL" };
  }

  const body = JSON.stringify({ secret: process.env.GAS_SECRET, ...payload });

  // Retry up to 2 times on transient errors
  let last = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 15000); // 15s
      const resp = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        signal: controller.signal
      });
      clearTimeout(timer);

      const txt = await resp.text();
      let json;
      try { json = JSON.parse(txt); } catch { json = { ok: false, parseError: true, raw: txt }; }

      if (json?.ok) return json;
      last = json || { ok: false, raw: txt };
      // break on auth/config style errors; no point retrying
      if (/unauthorized|bad secret|missing op|not_found|unknown_op/i.test(JSON.stringify(last))) break;
    } catch (e) {
      last = { ok: false, network: true, error: String(e) };
    }
    await new Promise(r => setTimeout(r, 400 * attempt)); // backoff
  }
  return last || { ok: false, error: "Unknown GAS error" };
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    // --- Parse JSON safely
    const body = typeof req.body === "object" && req.body !== null ? req.body : JSON.parse(req.body || "{}");

    // --- OPTIONAL: Verify Seal webhook HMAC if available
    if (process.env.SEAL_API_SECRET) {
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(body);
      const sig = req.headers["x-seal-hmac-sha256"];
      const calc = createHmac("sha256", process.env.SEAL_API_SECRET).update(raw, "utf8").digest("hex");
      if (!sig || !timingSafeEqual_(calc, String(sig))) {
        // Return 401 in strict prod; during dev, log and continue:
        console.warn("Seal HMAC mismatch (continuing in dev):", { provided: sig, expected: calc });
        // return res.status(401).json({ ok:false, error:"Bad signature" });
      }
    }

    // --- Extract key fields from Seal payload
    const subscriptionId =
      (body && (body.id ?? body.subscription_id)) ??
      (body?.subscription?.id) ??
      (body?.data?.id);

    const orderId =
      body?.order_id ?? body?.subscription?.order_id ?? body?.data?.order_id ?? "";

    const customerEmail =
      body?.email ?? body?.customer?.email ?? body?.data?.email ?? "";

    if (!subscriptionId) {
      return res.status(200).json({ ok: false, error: "Missing subscriptionId in payload", echo: body });
    }

    console.log("Seal webhook received:", {
      subscriptionId: String(subscriptionId),
      orderId: String(orderId || ""),
      email: customerEmail || "",
      status: body?.status || ""
    });

    // --- Pause in Seal (non-fatal if it fails)
    if (process.env.SEAL_API_KEY) {
      try {
        const resp = await fetch("https://app.sealsubscriptions.com/shopify/merchant/api/subscription", {
          method: "PUT",
          headers: {
            "Content-Type": "application/json",
            "X-Seal-Token": process.env.SEAL_API_KEY
          },
          body: JSON.stringify({ id: Number(subscriptionId), action: "pause" })
        });
        if (!resp.ok) {
          const txt = await resp.text();
          console.error("Seal pause failed:", txt);
        }
      } catch (e) {
        console.error("Seal pause error:", e);
      }
    } else {
      console.warn("SEAL_API_KEY missing – skipping pause call");
    }

    // --- Build activation URL
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    if (!appUrl) return res.status(500).json({ ok: false, error: "APP_URL not set" });

    const code = makeCode(12);
    const activateUrl = `${appUrl}/api/activate?code=${encodeURIComponent(code)}&subId=${encodeURIComponent(String(subscriptionId))}`;

    // --- Generate QR (as Data URL)
    let qrDataUrl = "";
    try {
      qrDataUrl = await QRCode.toDataURL(activateUrl);
    } catch (e) {
      console.error("QR generation failed:", e);
    }

    // --- Persist to Google Sheet (Apps Script) and surface the response
    let gasSave = null;
    if (process.env.GAS_URL && process.env.GAS_SECRET) {
      gasSave = await saveToGAS({
        op: "save",
        code,
        subscriptionId: String(subscriptionId),
        status: "unused",
        customerEmail,
        qrUrl: qrDataUrl,
        activateUrl
      });

      if (!gasSave?.ok) {
        console.error("GAS save failed:", gasSave);
      }
    } else {
      // In-memory fallback (testing only)
      (globalThis.__codes ||= new Map()).set(code, {
        subscriptionId: String(subscriptionId),
        used: false,
        issuedAt: Date.now(),
        customerEmail,
        orderId: String(orderId || "")
      });
      gasSave = { ok: false, warning: "GAS not configured; saved to memory only" };
    }

    // --- Compact logs (avoid dumping base64)
    console.log("Generated activation", {
      subscriptionId: String(subscriptionId),
      code,
      activateUrl,
      gasOk: !!(gasSave && gasSave.ok),
      qrPreview: qrDataUrl ? qrDataUrl.slice(0, 32) + "…(base64)" : null
    });

    // --- Final response (includes gasSave so you can see why it didn't write)
    return res.status(200).json({
      ok: true,
      subscriptionId: String(subscriptionId),
      orderId: String(orderId || ""),
      customerEmail,
      code,
      activateUrl,
      qrDataUrl,
      gasSave
    });
  } catch (err) {
    console.error("seal-created error:", err);
    return res.status(200).json({ ok: false, error: String(err) });
  }
}

/** Generate a short, URL-safe, uppercase code */
function makeCode(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64url").slice(0, len).toUpperCase();
}
