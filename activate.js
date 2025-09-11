// api/activate.js

// Same memory map as in initialize.js (shared in the same process)
const memory = globalThis.__codes || (globalThis.__codes = new Map());

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).send("Method not allowed");
    }

    const code = req.query.code;
    const subId = req.query.subId;

    if (!code || !subId) {
      return res.status(400).send("Missing code or subId");
    }

    const record = memory.get(code);
    if (!record || record.used || record.subscriptionId !== subId) {
      return res.status(400).send("Invalid or already used code");
    }

    const SEAL_API_KEY = process.env.SEAL_API_KEY;
    if (!SEAL_API_KEY) {
      return res.status(500).send("Server missing SEAL_API_KEY");
    }

    // Resume subscription in Seal
    const resumeResp = await fetch(`https://api.sealsubscriptions.com/v1/subscriptions/${subId}/resume`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${SEAL_API_KEY}`,
        "Content-Type": "application/json"
      }
    });

    if (!resumeResp.ok) {
      const txt = await resumeResp.text();
      return res.status(502).send(`Seal resume failed: ${txt}`);
    }

    // Mark used
    record.used = true;
    memory.set(code, record);

    // Simple HTML confirmation (you can brand this later)
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`
      <div style="font-family:system-ui;margin:40px;">
        <h2>✅ Subscription activated</h2>
        <p>Your subscription (<code>${escapeHtml(subId)}</code>) is now active.</p>
        <p>You can close this window.</p>
      </div>
    `);
  } catch (err) {
    return res.status(500).send(String(err));
  }
}

function escapeHtml(s = "") {
  return String(s).replace(/[&<>"']/g, c => ({ "&":"&amp;","<":"&lt;",">":"&gt;","\"":"&quot;","'":"&#39;" }[c]));
}
