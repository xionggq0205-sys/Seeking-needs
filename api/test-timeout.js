export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const seconds = parseInt(new URL(req.url, "http://localhost").searchParams.get("s") || "5");
  const capped = Math.min(seconds, 55);
  const start = Date.now();
  await new Promise(r => setTimeout(r, capped * 1000));
  res.status(200).json({ ok: true, waitedMs: Date.now() - start, requested: capped });
}
