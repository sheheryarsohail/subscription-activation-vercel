// api/echo.js
export default async function handler(req, res) {
  res.setHeader("Content-Type", "application/json");
  return res.status(200).json({
    ok: true,
    method: req.method,
    query: req.query,
    haveGAS: !!(process.env.GAS_URL && process.env.GAS_SECRET),
    haveSeal: !!process.env.SEAL_API_KEY
  });
}
