// api/activate.js — debug-only version that ALWAYS returns JSON
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      res.setHeader("Content-Type", "application/json");
      return res.status(405).json({ ok:false, where:"method", error:"Method not allowed" });
    }

    const code  = String(req.query.code || "").trim();
    const subId = String(req.query.subId || "").trim();
    res.setHeader("Content-Type", "application/json");

    if (!code || !subId) {
      return res.status(200).json({ ok:false, where:"params", error:"Missing code or subId", code, subId });
    }

    // 1) Lookup in Google Apps Script
    let data = null;
    const useGAS = !!(process.env.GAS_URL && process.env.GAS_SECRET);

    if (useGAS) {
      const resp = await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "get", code })
      });
      const txt = await resp.text();
      try { data = JSON.parse(txt); } catch (e) { data = { ok:false, parseError:true, raw:txt }; }

      if (!data?.ok) {
        return res.status(200).json({ ok:false, where:"lookup", details:data, sent:{ code, subId } });
      }
    } else {
      const store = (globalThis.__codes ||= new Map());
      const mem = store.get(code);
      if (!mem) {
        return res.status(200).json({ ok:false, where:"lookup_memory", error:"No record in memory", code, subId });
      }
      data = { ok:true, subscriptionId:String(mem.subscriptionId), status:(mem.used?"used":"unused") };
    }

    const sheetSubId = String(data.subscriptionId || "");
    const status     = String(data.status || "unused");

    if (sheetSubId !== subId) {
      return res.status(200).json({ ok:false, where:"mismatch", sheetSubId, urlSubId:subId });
    }
    if (status === "used") {
      return res.status(200).json({ ok:false, where:"already_used" });
    }

    // 2) Resume in Seal
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
      return res.status(200).json({ ok:false, where:"seal_resume", statusCode: sealResp.status, sealResponse: sealTxt });
    }

    // 3) Mark used
    if (useGAS) {
      const mark = await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "mark_used", code, subscriptionId: subId })
      });
      const markTxt = await mark.text();
      let markJson; try { markJson = JSON.parse(markTxt); } catch { markJson = { ok:false, parseError:true, raw:markTxt }; }
      if (!markJson?.ok) {
        return res.status(200).json({ ok:false, where:"mark_used", response:markJson });
      }
    } else {
      const store = (globalThis.__codes ||= new Map());
      const mem = store.get(code);
      if (mem) { mem.used = true; store.set(code, mem); }
    }

    // Success
    return res.status(200).json({ ok:true, activated:true, subscriptionId: subId, code });
  } catch (err) {
    res.setHeader("Content-Type", "application/json");
    return res.status(200).json({ ok:false, where:"catch", error:String(err) });
  }
}
