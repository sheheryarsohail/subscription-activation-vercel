// /api/seal-created.js
import QRCode from "qrcode";
import { sql } from "@vercel/postgres";
import { createHmac, randomBytes } from "node:crypto";

// constant-time compare
function timingSafeEqual_(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

// short, URL-safe, uppercase code
function makeCode(len = 12) {
  // base64url w/out padding, then slice to len
  const b64url = randomBytes(18) // ~24 chars b64url
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
  return b64url.slice(0, len).toUpperCase();
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ ok: false, error: "Method not allowed" });
    }

    // Parse JSON safely (Vercel usually parses, but guard anyway)
    const body =
      typeof req.body === "object" && req.body !== null
        ? req.body
        : JSON.parse(req.body || "{}");

    // OPTIONAL: Verify Seal webhook HMAC (if you set SEAL_API_SECRET in env)
    if (process.env.SEAL_API_SECRET) {
      const raw = typeof req.body === "string" ? req.body : JSON.stringify(body);
      const provided = req.headers["x-seal-hmac-sha256"];
      const expected = createHmac("sha256", process.env.SEAL_API_SECRET)
        .update(raw, "utf8")
        .digest("hex");
      if (!provided || !timingSafeEqual_(expected, String(provided))) {
        // In production you can reject:
        // return res.status(401).json({ ok:false, error:"Bad signature" });
        console.warn("Seal HMAC mismatch (continuing in dev):", {
          provided,
          expected,
        });
      }
    }

    // Extract fields (covers common Seal payload shapes)
    const subscriptionId =
      (body && (body.id ?? body.subscription_id)) ??
      body?.subscription?.id ??
      body?.data?.id;

    const orderId =
      body?.order_id ?? body?.subscription?.order_id ?? body?.data?.order_id ?? "";

    const customerEmail =
      body?.email ?? body?.customer?.email ?? body?.data?.email ?? "";

    if (!subscriptionId) {
      return res
        .status(200)
        .json({ ok: false, error: "Missing subscriptionId in payload", echo: body });
    }

    console.log("Seal webhook received:", {
      subscriptionId: String(subscriptionId),
      orderId: String(orderId || ""),
      email: customerEmail || "",
      status: body?.status || "",
    });

    // Pause the subscription in Seal (best effort)
    if (process.env.SEAL_API_KEY) {
      try {
        const resp = await fetch(
          "https://app.sealsubscriptions.com/shopify/merchant/api/subscription",
          {
            method: "PUT",
            headers: {
              "Content-Type": "application/json",
              "X-Seal-Token": process.env.SEAL_API_KEY,
            },
            body: JSON.stringify({ id: Number(subscriptionId), action: "pause" }),
          }
        );
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

    // Build activation URL
    const appUrl = (process.env.APP_URL || "").replace(/\/$/, "");
    if (!appUrl) return res.status(500).json({ ok: false, error: "APP_URL not set" });

    const code = makeCode(12);
    const activateUrl = `${appUrl}/api/activate?code=${encodeURIComponent(
      code
    )}&subId=${encodeURIComponent(String(subscriptionId))}`;

    // Generate QR (as data URL)
    let qrDataUrl = "";
    try {
      qrDataUrl = await QRCode.toDataURL(activateUrl);
    } catch (e) {
      console.error("QR generation failed:", e);
      // continue; we can still save the link
    }

    // Save to Postgres (replace any old row with same code)
    await sql`
      insert into activation_codes
        (code, subscription_id, status, issued_at, customer_email, qr_url, activate_url)
      values
        (${code}, ${String(subscriptionId)}, 'unused', now(), ${
      customerEmail || null
    }, ${qrDataUrl || null}, ${activateUrl || null})
      on conflict (code) do update set
        subscription_id = excluded.subscription_id,
        customer_email  = excluded.customer_email,
        qr_url          = excluded.qr_url,
        activate_url    = excluded.activate_url,
        status          = 'unused',
        issued_at       = now(),
        used_at         = null;
    `;

    // Compact logs (don’t print full base64)
    console.log("Generated activation", {
      subscriptionId: String(subscriptionId),
      code,
      activateUrl,
      qrPreview: qrDataUrl ? qrDataUrl.slice(0, 32) + "…(base64)" : null,
    });

    // Final response
    return res.status(200).json({
      ok: true,
      subscriptionId: String(subscriptionId),
      orderId: String(orderId || ""),
      customerEmail,
      code,
      activateUrl,
      qrDataUrl,
      storage: "postgres",
    });
  } catch (err) {
    console.error("seal-created error:", err);
    return res.status(500).json({ ok: false, error: String(err) });
  }
}
