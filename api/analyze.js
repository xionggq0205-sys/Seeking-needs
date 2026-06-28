// Vercel Serverless Function — POST /api/analyze
// 流程:扩词(模型) → 抓真实数据(HN + 可选 Reddit) → 基于证据做痛点分析(模型)。
// 模型走兼容 OpenAI 的接口(默认 DeepSeek),见 lib/claude.js。

import { expandQuery, buildQueries, analyzeCorpus } from "../lib/analyze.js";
import { gather } from "../lib/sources.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const input = (body.input || "").toString().trim();
    if (!input) {
      res.status(400).json({ error: "缺少 input 字段" });
      return;
    }
    if (!process.env.LLM_API_KEY) {
      res.status(500).json({ error: "服务器未配置 LLM_API_KEY 环境变量" });
      return;
    }

    const expansion = await expandQuery(input);
    const queries = buildQueries(expansion, input);
    const items = await gather(queries, { perQuery: 7, sinceDays: 540 });
    const report = await analyzeCorpus(input, items, { maxPains: 3 });
    if (report.error) {
      res.status(200).json(report);
      return;
    }
    report.expansion = expansion;
    report.fetchedCount = items.length;
    res.status(200).json(report);
  } catch (e) {
    res.status(500).json({ error: e.message || "unknown error" });
  }
}
