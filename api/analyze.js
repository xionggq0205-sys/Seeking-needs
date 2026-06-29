// Vercel Serverless Function — POST /api/analyze
// 流程: 抓真实数据(HN) → 过滤噪音 → 基于证据做痛点分析(模型)。
// 必须传入 expansion（由 /api/expand 返回），避免单个函数内做两次 LLM 调用超时。
// Vercel Hobby 函数硬限约 12s，整体加了 11s 保护。

import { buildQueries, analyzeCorpus, filterByExcluded, filterNoise } from "../lib/analyze.js";
import { gather } from "../lib/sources.js";
import { costTracker } from "../lib/llm.js";
import { fetchTrends } from "../lib/googleTrends.js";

function withTimeout(promise, ms) {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(`函数执行超时(${ms}ms)`)), ms)),
  ]);
}

export default async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  async function doWork() {
    const body = typeof req.body === "string" ? JSON.parse(req.body || "{}") : (req.body || {});
    const input = (body.input || "").toString().trim();
    if (!input) return res.status(400).json({ error: "缺少 input 字段" });
    if (!body.expansion || !body.expansion.englishSearchQuery) return res.status(400).json({ error: "缺少 expansion 字段，请先调用 /api/expand" });
    if (!process.env.LLM_API_KEY) return res.status(500).json({ error: "服务器未配置 LLM_API_KEY 环境变量。" });

    costTracker.reset();
    const expansion = body.expansion;

    const queries = buildQueries(expansion, input).slice(0, 3);
    let items = await gather(queries, { perQuery: 4, sinceDays: 365 });

    items = filterByExcluded(items, expansion.excludedTerms);
    items = filterNoise(items);
    items = items.slice(0, 20);

    // 并行：LLM 分析 + Google Trends（非官方端点，失败降级为不可用）。
    const trendsPromise = fetchTrends(expansion.englishSearchQuery || input, { months: 12, timeoutMs: 8000 });
    const report = await analyzeCorpus(input, items, { maxPains: 3, maxTokens: 3500 });
    if (report.error) return res.status(200).json(report);
    report.expansion = expansion;
    report.fetchedCount = items.length;
    report.llmUsage = costTracker.summary();
    report.trends = await trendsPromise;
    return res.status(200).json(report);
  }

  try {
    await withTimeout(doWork(), 55_000);
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || "unknown error" });
    }
  }
}
