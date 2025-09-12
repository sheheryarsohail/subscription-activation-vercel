// api/seal-created.js
export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).send("Method not allowed");

  const payload = req.body; // Seal sends JSON
  console.log("Seal webhook payload:", payload);

  // Example Seal webhook includes:
  // { id: 123456, order_id: "7890123456", email: "customer@email.com", ... }

  const subscriptionId = String(payload.id);
  const customerEmail = payload.email || "";

  // 👉 At this point you have the true subscriptionId
  // Call your existing initialize logic:
  // - Pause subscription via Seal API
  // - Generate code + QR
  // - Save to Google Sheet / KV
  // - Send email (via Klaviyo or Shopify Email)

  return res.status(200).json({ ok: true });
}
