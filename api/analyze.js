// Vercel Serverless Function — POST /api/analyze
// 流程: 抓真实数据(HN + 可选 Reddit) → 过滤噪音 → 基于证据做痛点分析(模型)。
// 必须传入 expansion（由 /api/expand 返回），避免单个函数内做两次 LLM 调用超时。

import { buildQueries, analyzeCorpus, filterByExcluded, filterNoise } from "../lib/analyze.js";
import { gather } from "../lib/sources.js";
import { costTracker } from "../lib/llm.js";

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
    if (!body.expansion || !body.expansion.englishSearchQuery) {
      res.status(400).json({ error: "缺少 expansion 字段，请先调用 /api/expand" });
      return;
    }
    if (!process.env.LLM_API_KEY) {
      res.status(500).json({ error: "服务器未配置 LLM_API_KEY 环境变量。请在 Vercel 项目 Settings → Environment Variables 中添加 LLM_API_KEY。" });
      return;
    }

    costTracker.reset();
    const expansion = body.expansion;

    const queries = buildQueries(expansion, input).slice(0, 3);
    let items = await gather(queries, { perQuery: 4, sinceDays: 365 });

    items = filterByExcluded(items, expansion.excludedTerms);
    items = filterNoise(items);
    items = items.slice(0, 25);

    const report = await analyzeCorpus(input, items, { maxPains: 3, maxTokens: 1500 });
    if (report.error) {
      res.status(200).json(report);
      return;
    }
    report.expansion = expansion;
    report.fetchedCount = items.length;
    report.llmUsage = costTracker.summary();
    res.status(200).json(report);
  } catch (e) {
    res.status(500).json({ error: e.message || "unknown error" });
  }
}
