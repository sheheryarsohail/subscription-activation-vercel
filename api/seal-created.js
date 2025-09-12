// api/seal-created.js
import QRCode from "qrcode";
import { createHmac } from "node:crypto";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ ok: false, error: "Method not allowed" });

    // --- Parse JSON safely (Vercel usually parses JSON for us if header is correct)
    const body = typeof req.body === "object" && req.body !== null
      ? req.body
      : JSON.parse(req.body || "{}");

    // --- OPTIONAL: Verify Seal webhook HMAC if SEAL_API_SECRET is set
    // Seal sends header: X-Seal-Hmac-Sha256 (hex). We compute HMAC of the raw body.
    // If you didn’t enable HMAC in Seal yet, keep SEAL_API_SECRET empty and this will be skipped.
    if (process.env.SEAL_API_SECRET) {
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(body);
      const sig = req.headers["x-seal-hmac-sha256"];
      const calc = createHmac("sha256", process.env.SEAL_API_SECRET).update(raw, "utf8").digest("hex");
      if (!sig || !timingSafeEqual_(calc, String(sig))) {
        console.error("Bad Seal HMAC:", { sig, calc });
        // You can `return res.status(401).json({ ok:false, error:"Bad signature" })`
        // but during testing we allow it through; switch to 401 in prod if you like:
        // return res.status(401).json({ ok:false, error:"Bad signature" });
      }
    }

    // --- Extract fields from Seal payload (covers common shapes)
    const subscriptionId =
      (body && (body.id ?? body.subscription_id)) ??
      (body?.subscription?.id) ??
      (body?.data?.id);

    const orderId =
      body?.order_id ?? body?.subscription?.order_id ?? body?.data?.order_id ?? "";

    const customerEmail =
      body?.email ?? body?.customer?.email ?? body?.data?.email ?? "";

    if (!subscriptionId) {
      console.error("Missing subscriptionId in payload. Echoing body for mapping help.");
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
        // continue anyway; we still want to emit code+QR
      }
    } else {
      console.warn("SEAL_API_KEY missing – skipping pause call");
    }

    // --- Build activation URL
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    if (!appUrl) {
      console.error("APP_URL missing; cannot build activateUrl");
      return res.status(500).json({ ok: false, error: "APP_URL not set" });
    }

    const code = makeCode(12);
    const activateUrl = `${appUrl}/api/activate?code=${encodeURIComponent(code)}&subId=${encodeURIComponent(String(subscriptionId))}`;

    // --- Generate QR (as Data URL)
    let qrDataUrl = "";
    try {
      qrDataUrl = await QRCode.toDataURL(activateUrl);
    } catch (e) {
      console.error("QR generation failed:", e);
      // still proceed; you can send just link in email
    }

    // --- Persist to Google Sheet (Apps Script)
    if (process.env.GAS_URL && process.env.GAS_SECRET) {
      const saveBody = {
        secret: process.env.GAS_SECRET,
        op: "save",
        code,
        subscriptionId: String(subscriptionId),
        status: "unused",
        customerEmail,
        qrUrl: qrDataUrl,     // store QR data URL (base64)
        activateUrl           // store activation link
      };

      const saveResp = await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(saveBody)
      });

      const saveTxt = await saveResp.text();
      let saveJson;
      try { saveJson = JSON.parse(saveTxt); } catch { saveJson = { ok: false, parseError: true, raw: saveTxt }; }

      if (!saveJson?.ok) {
        console.error("GAS save failed:", saveJson);
        // Not fatal for response, but you may want to alert here
      }
    } else {
      // Simple in-memory fallback for testing
      (globalThis.__codes ||= new Map()).set(code, {
        subscriptionId: String(subscriptionId),
        used: false,
        issuedAt: Date.now(),
        customerEmail,
        orderId: String(orderId || "")
      });
      console.warn("GAS_URL / GAS_SECRET not set: saved to memory only (will not persist)");
    }

    // --- Keep logs compact (don’t print entire QR base64)
    console.log("Generated activation", {
      subscriptionId: String(subscriptionId),
      code,
      activateUrl,
      qrPreview: qrDataUrl ? qrDataUrl.slice(0, 32) + "…(base64)" : null
    });

    // --- Final response (handy for testing / Shopify Flow HTTP action)
    return res.status(200).json({
      ok: true,
      subscriptionId: String(subscriptionId),
      orderId: String(orderId || ""),
      customerEmail,
      code,
      activateUrl,
      qrDataUrl
    });
  } catch (err) {
    console.error("seal-created error:", err);
    return res.status(200).json({ ok: false, error: String(err) });
  }
}

/** Generate a short, URL-safe, uppercase code */
function makeCode(len = 12) {
  // Node 20 has WebCrypto on globalThis
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64url").slice(0, len).toUpperCase();
}

/** Constant-time compare to avoid timing leaks (best-effort) */
function timingSafeEqual_(a, b) {
  if (a.length !== b.length) return false;
  // XOR every char; zero means equal
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}
