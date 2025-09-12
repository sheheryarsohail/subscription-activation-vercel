// api/index.js
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({ ok:true, msg:"API root alive" });
}
