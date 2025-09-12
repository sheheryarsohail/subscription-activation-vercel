// api/seal-created.js
export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).send("Method not allowed");
    }

    // Safely parse JSON whether Vercel parsed it or not
    const payload =
      typeof req.body === "object" && req.body !== null
        ? req.body
        : JSON.parse(req.body || "{}");

    console.log("Seal webhook payload:", payload);

    // TEMP: don’t do any HMAC check or external calls yet.
    // We just want a reliable 200 to verify wiring.
    return res.status(200).json({ ok: true });
  } catch (err) {
    console.error("seal-created error:", err);
    // Always return something JSON-y to help debug
    return res.status(200).json({ ok: false, error: String(err) });
  }
}
