// Vercel Serverless Function — POST /api/analyze
// 流程: 扩词(模型) → 抓真实数据(HN + 可选 Reddit) → 过滤噪音 → 基于证据做痛点分析(模型)。
// 支持传入自定义 expansion 跳过扩词步骤（用于用户编辑扩词后重新检索）。

import { expandQuery, buildQueries, analyzeCorpus, filterByExcluded, filterNoise } from "../lib/analyze.js";
import { gather } from "../lib/sources.js";
import { costTracker } from "../lib/llm.js";

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
      res.status(500).json({ error: "服务器未配置 LLM_API_KEY 环境变量。请在 Vercel 项目 Settings → Environment Variables 中添加 LLM_API_KEY（DeepSeek API Key）。" });
      return;
    }

    costTracker.reset();

    const expansion = body.expansion && body.expansion.englishSearchQuery
      ? body.expansion
      : await expandQuery(input);

    const queries = buildQueries(expansion, input);
    let items = await gather(queries, { perQuery: 7, sinceDays: 540 });

    items = filterByExcluded(items, expansion.excludedTerms);
    items = filterNoise(items);

    const report = await analyzeCorpus(input, items, { maxPains: 3 });
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
