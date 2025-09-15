// /api/activate.js
import { sql } from "@vercel/postgres";

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") return res.status(405).send("Method not allowed");

    const code  = String(req.query.code || "").trim();
    const subId = String(req.query.subId || "").trim();
    if (!code || !subId) return res.status(400).send("Missing code or subId");

    // 1) Lookup code in Postgres
    const { rows } = await sql`
      select code, subscription_id, status
      from activation_codes
      where code = ${code}
      limit 1;
    `;
    if (!rows.length) return res.status(400).send("Invalid or unknown code");

    const row = rows[0];
    if (String(row.subscription_id) !== subId) {
      return res.status(400).send("Code does not match this subscription");
    }
    if (row.status === "used") {
      return res.status(400).send("Code already used");
    }

    // 2) Resume subscription in Seal
    const sealResp = await fetch(
      "https://app.sealsubscriptions.com/shopify/merchant/api/subscription",
      {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          "X-Seal-Token": process.env.SEAL_API_KEY,
        },
        body: JSON.stringify({ id: Number(subId), action: "resume" }),
      }
    );
    if (!sealResp.ok) {
      const txt = await sealResp.text();
      console.error("Seal resume failed:", txt);
      return res.status(502).send("Resume failed");
    }

    // 3) Mark code as used
    await sql`
      update activation_codes
      set status = 'used', used_at = now()
      where code = ${code};
    `;

    // 4) Success page
    res.setHeader("Content-Type", "text/html; charset=utf-8");
    return res.status(200).send(`<!doctype html>
<html lang="en"><head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Subscription Activated</title>
<style>
body{font-family:system-ui,-apple-system,Segoe UI,Roboto,sans-serif;background:#f7f7f8;margin:0}
.card{max-width:560px;margin:12vh auto;background:#fff;padding:28px;border-radius:16px;box-shadow:0 6px 28px rgba(0,0,0,.07);text-align:center}
h1{font-size:22px;margin:0 0 8px}p{margin:8px 0;color:#333;line-height:1.5}.ok{font-size:42px}.muted{color:#666;font-size:14px}
.btn{margin-top:14px;display:inline-block;background:#111;color:#fff;text-decoration:none;padding:10px 14px;border-radius:10px;cursor:pointer}
.hint{font-size:13px;color:#666;margin-top:12px;display:none}code{background:#f2f2f3;padding:2px 6px;border-radius:6px}
</style></head>
<body><div class="card">
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
  const closeBtn=document.getElementById('closeBtn');
  const hint=document.getElementById('hint');
  closeBtn.addEventListener('click',function(){
    window.open('','_self'); window.close();
    setTimeout(function(){
      if(!document.hidden){
        const mac=/Mac|iPhone|iPad/.test(navigator.platform);
        hint.textContent=mac?'If this tab does not close automatically, press Command (⌘) + W to close it.':'If this tab does not close automatically, press Ctrl + W to close it.';
        hint.style.display='block';
      }
    },300);
  });
})();
</script>
</body></html>`);
  } catch (err) {
    console.error("activate error:", err);
    return res.status(500).send("Server error");
  }
}

function escapeHtml(s=""){ 
  return String(s).replace(/[&<>"']/g, c => ({
    '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); 
}
