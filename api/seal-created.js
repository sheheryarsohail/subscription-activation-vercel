// api/seal-created.js
import QRCode from "qrcode";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).send("Method not allowed");

    // Parse JSON safely
    const body = typeof req.body === "object" && req.body !== null
      ? req.body
      : JSON.parse(req.body || "{}");

    // Log everything so we can see the real shape in Vercel logs
    console.log("Seal webhook raw body:", JSON.stringify(body));

    // 👇 Try common shapes from Seal webhooks
    const subscriptionId =
      // simple: { id: 123 }
      (body && (body.id ?? body.subscription_id)) ??
      // nested: { subscription: { id: 123 } }
      (body?.subscription?.id) ??
      // nested in data: { data: { id: 123 } }
      (body?.data?.id);

    const orderId =
      body?.order_id ?? body?.subscription?.order_id ?? body?.data?.order_id ?? "";
    const customerEmail =
      body?.email ?? body?.customer?.email ?? body?.data?.email ?? "";

    if (!subscriptionId) {
      // Return body back to you so you can see what to map
      return res.status(200).json({
        ok: false,
        error: "Missing subscriptionId in payload",
        echo: body
      });
    }

    // Pause the subscription in Seal (non-fatal if it fails)
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
    }

    // Generate code + activation link + QR
    const code = makeCode(12);
    const activateUrl = `${process.env.APP_URL.replace(/\/$/,"")}/api/activate?code=${encodeURIComponent(code)}&subId=${encodeURIComponent(subscriptionId)}`;
    const qrDataUrl = await QRCode.toDataURL(activateUrl);

    // Persist (Google Apps Script if configured; else in-memory for test)
    if (process.env.GAS_URL && process.env.GAS_SECRET) {
      await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          secret: process.env.GAS_SECRET,
          op: "save",
          code,
          subscriptionId: String(subscriptionId),
          status: "unused",
          customerEmail
        })
      });
    } else {
      (globalThis.__codes ||= new Map()).set(code, {
        subscriptionId: String(subscriptionId),
        used: false,
        issuedAt: Date.now(),
        customerEmail,
        orderId: String(orderId)
      });
    }

    // Return all the goodies so you can see them
    return res.status(200).json({
      ok: true,
      subscriptionId: String(subscriptionId),
      orderId: String(orderId),
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

function makeCode(len = 12) {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Buffer.from(bytes).toString("base64url").slice(0, len).toUpperCase();
}
