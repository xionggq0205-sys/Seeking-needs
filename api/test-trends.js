// 临时探测：测试 Google Trends 在 Vercel 上是否可达。验证后删除。
import { fetchTrends } from "../lib/googleTrends.js";

export default async function handler(req, res) {
  const start = Date.now();
  const kw = (req.query?.q || "epub converter").toString();
  const geo = (req.query?.geo || "").toString();
  try {
    const r = await fetchTrends(kw, { geo, months: 12 });
    res.status(200).json({ ok: true, ms: Date.now() - start, kw, geo, result: r });
  } catch (e) {
    res.status(200).json({ ok: false, ms: Date.now() - start, error: e.message, stack: e.stack?.slice(0, 400) });
  }
}
