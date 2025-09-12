// api/activate.js
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const code  = String(req.query.code || "").trim();
    const subId = String(req.query.subId || "").trim();
    if (!code || !subId) return res.status(400).send("Missing code or subId");

    // 1) Look up the code → subscriptionId (GAS if configured; else in-memory Map from seal-created)
    let record = null;

    if (process.env.GAS_URL && process.env.GAS_SECRET) {
      // Ask Apps Script for the code row
      const resp = await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "get", code })
      });
      const data = await resp.json().catch(() => ({}));
      if (!data?.ok) {
        return res.status(400).send("Invalid or unknown code");
      }
      record = {
        subscriptionId: String(data.subscriptionId || ""),
        status: data.status || "unused",
        customerEmail: data.customerEmail || "",
      };
    } else {
      // In-memory store (used during testing in seal-created)
      const store = (globalThis.__codes ||= new Map());
      const mem = store.get(code);
      if (!mem) return res.status(400).send("Invalid or unknown code");
      record = {
        subscriptionId: String(mem.subscriptionId || ""),
        status: mem.used ? "used" : "unused",
        customerEmail: mem.customerEmail || "",
      };
    }

    // 2) Validate mapping
    if (record.subscriptionId !== subId) {
      return res.status(400).send("Code does not match this subscription");
    }
    if (record.status === "used") {
      return res.status(400).send("Code already used");
    }

    // 3) (Optional) enforce expiry if you stored one — skip for now

    // 4) Resume subscription in Seal
    const resumeResp = await fetch("https://app.sealsubscriptions.com/shopify/merchant/api/subscription", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Seal-Token": process.env.SEAL_API_KEY
      },
      body: JSON.stringify({ id: Number(subId), action: "resume" })
    });

    if (!resumeResp.ok) {
      const txt = await resumeResp.text();
      return res.status(502).send(`Seal resume failed: ${txt}`);
    }

    // 5) Mark code used
    if (process.env.GAS_URL && process.env.GAS_SECRET) {
      await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "mark_used", code, subscriptionId: subId })
      });
    } else {
      const store = (globalThis.__codes ||= new Map());
      const mem = store.get(code);
      if (mem) { mem.used = true; store.set(code, mem); }
    }

    // 6) Simple confirmation page
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`
      <div style="font-family:system-ui;margin:40px;max-width:560px;line-height:1.4">
        <h2>✅ Subscription activated</h2>
        <p>Subscription <code>${escapeHtml(subId)}</code> is now active.</p>
        <p>You may close this window.</p>
      </div>
    `);
  } catch (err) {
    console.error("activate error:", err);
    return res.status(500).send("Server error");
  }
}

function escapeHtml(s=""){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
