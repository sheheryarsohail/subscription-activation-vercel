// api/activate.js (debug)
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const code  = String(req.query.code || "").trim();
    const subId = String(req.query.subId || "").trim();
    if (!code || !subId) return res.status(400).send("Missing code or subId");

    // ---- DEBUG: verify envs are present
    const useGAS = !!(process.env.GAS_URL && process.env.GAS_SECRET);

    // 1) Look up code in Google Apps Script
    let data = null, gasStatus = "skipped";
    if (useGAS) {
      gasStatus = "called";
      const resp = await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "get", code })
      });
      // Apps Script always returns 200 with JSON body
      const txt = await resp.text();
      try { data = JSON.parse(txt); } catch { data = { ok:false, parseError:true, raw: txt }; }
      // If lookup fails, return a detailed JSON instead of the generic message
      if (!data?.ok) {
        return res.status(200).json({
          ok: false,
          where: "lookup",
          gasStatus,
          request: { code, subId },
          response: data
        });
      }
    } else {
      // In-memory path (test fallback)
      const store = (globalThis.__codes ||= new Map());
      const mem = store.get(code);
      if (!mem) {
        return res.status(200).json({
          ok: false,
          where: "memory_lookup",
          request: { code, subId },
          note: "No GAS configured and code not in memory"
        });
      }
      data = { ok: true, subscriptionId: String(mem.subscriptionId), status: mem.used ? "used" : "unused" };
    }

    const subscriptionId = String(data.subscriptionId || "");
    const status = String(data.status || "unused");

    // 2) Validate mapping
    if (subscriptionId !== subId) {
      return res.status(200).json({
        ok: false,
        where: "mismatch",
        details: "Code does not match this subscription",
        sheetSubscriptionId: subscriptionId,
        urlSubId: subId
      });
    }
    if (status === "used") {
      return res.status(200).json({
        ok: false,
        where: "already_used",
        details: "Code already used"
      });
    }

    // 3) Resume in Seal
    const sealResp = await fetch("https://app.sealsubscriptions.com/shopify/merchant/api/subscription", {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        "X-Seal-Token": process.env.SEAL_API_KEY
      },
      body: JSON.stringify({ id: Number(subId), action: "resume" })
    });
    const sealTxt = await sealResp.text();
    if (!sealResp.ok) {
      return res.status(200).json({
        ok: false,
        where: "seal_resume",
        statusCode: sealResp.status,
        sealResponse: sealTxt
      });
    }

    // 4) Mark used in Sheet
    if (useGAS) {
      const mark = await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "mark_used", code, subscriptionId: subId })
      });
      const markTxt = await mark.text();
      let markJson; try { markJson = JSON.parse(markTxt); } catch { markJson = { ok:false, parseError:true, raw:markTxt }; }
      if (!markJson?.ok) {
        return res.status(200).json({
          ok: false,
          where: "mark_used",
          response: markJson
        });
      }
    } else {
      const store = (globalThis.__codes ||= new Map());
      const mem = store.get(code);
      if (mem) { mem.used = true; store.set(code, mem); }
    }

    // 5) Success (HTML)
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`
      <div style="font-family:system-ui;margin:40px;max-width:560px;line-height:1.4">
        <h2>✅ Subscription activated</h2>
        <p>Subscription <code>${escapeHtml(subId)}</code> is now active.</p>
      </div>
    `);
  } catch (err) {
    return res.status(200).json({ ok:false, where:"catch", error:String(err) });
  }
}

function escapeHtml(s=""){ return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
