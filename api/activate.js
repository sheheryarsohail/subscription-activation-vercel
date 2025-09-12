// api/activate.js — resume + mark used, then show a simple success page
export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const code  = String(req.query.code || "").trim();
    const subId = String(req.query.subId || "").trim();
    if (!code || !subId) return res.status(400).send("Missing code or subId");

    // 1) Lookup code in Google Sheet
    if (!(process.env.GAS_URL && process.env.GAS_SECRET)) {
      return res.status(500).send("Storage not configured");
    }
    const lookupResp = await fetch(process.env.GAS_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "get", code })
    });
    const lookupTxt = await lookupResp.text();
    let data; try { data = JSON.parse(lookupTxt); } catch { return res.status(500).send("Lookup parse error"); }
    if (!data?.ok) return res.status(400).send("Invalid or unknown code");

    const sheetSubId = String(data.subscriptionId || "");
    const status     = String(data.status || "unused");
    if (sheetSubId !== subId) return res.status(400).send("Code does not match this subscription");
    if (status === "used")    return res.status(400).send("Code already used");

    // 2) Resume in Seal
    const sealResp = await fetch("https://app.sealsubscriptions.com/shopify/merchant/api/subscription", {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Seal-Token": process.env.SEAL_API_KEY },
      body: JSON.stringify({ id: Number(subId), action: "resume" })
    });
    if (!sealResp.ok) {
      const txt = await sealResp.text();
      console.error("Seal resume failed:", txt);
      return res.status(502).send("Resume failed");
    }

    // 3) Mark used in Sheet (best effort)
    try {
      const mark = await fetch(process.env.GAS_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ secret: process.env.GAS_SECRET, op: "mark_used", code, subscriptionId: subId })
      });
      const markTxt = await mark.text();
      let markJson; try { markJson = JSON.parse(markTxt); } catch {}
      if (!markJson?.ok) console.error("mark_used failed:", markTxt);
    } catch (e) {
      console.error("mark_used error:", e);
    }

    // 4) Show simple success page
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`
      <!doctype html>
      <html lang="en">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>Subscription Activated</title>
        <style>
          body { font-family: system-ui, -apple-system, Segoe UI, Roboto, sans-serif; background:#f7f7f8; margin:0; }
          .card { max-width: 560px; margin: 12vh auto; background:#fff; padding:28px; border-radius:16px; box-shadow: 0 6px 28px rgba(0,0,0,.07); text-align:center; }
          h1 { font-size: 22px; margin: 0 0 8px; }
          p { margin: 8px 0; color:#333; line-height:1.5 }
          .ok { font-size: 42px; }
          .muted { color:#666; font-size: 14px; }
          .btn { margin-top: 14px; display:inline-block; background:#111; color:#fff; text-decoration:none; padding:10px 14px; border-radius:10px; cursor:pointer; }
          .hint { font-size:13px; color:#666; margin-top:12px; display:none; }
          code { background:#f2f2f3; padding:2px 6px; border-radius:6px; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="ok">✅</div>
          <h1>Your subscription is activated</h1>
          <p>We’ve resumed your subscription.</p>
          <p class="muted">Check your email for your customer portal link.</p>
          <p class="muted">You can close this tab now.</p>
          <div class="row">Ref: <code>${escapeHtml(subId)}</code></div>
          <button id="closeBtn" class="btn">Close this tab</button>
          <div id="hint" class="hint"></div>
        </div>

        <script>
          (function(){
            const closeBtn = document.getElementById('closeBtn');
            const hint     = document.getElementById('hint');
            closeBtn.addEventListener('click', function(){
              window.open('','_self'); // helps some browsers
              window.close();
              setTimeout(function(){
                if (!document.hidden) {
                  const mac = /Mac|iPhone|iPad/.test(navigator.platform);
                  const shortcut = mac ? '⌘W' : 'Ctrl+W';
                  hint.textContent = 'If this tab does not close automatically, press ' + shortcut + ' to close it.';
                  hint.style.display = 'block';
                }
              }, 300);
            });
          })();
        </script>
      </body>
      </html>
    `);
  } catch (err) {
    console.error("activate error:", err);
    return res.status(500).send("Server error");
  }
}

function escapeHtml(s=""){ 
  return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); 
}
