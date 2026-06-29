// Vercel Serverless Function — POST /api/deepen
// 输入: { input, expansion }（必填，由 /api/expand 提供）
// 流程: 按竞品/定价/评测构造聚焦查询 → 抓 HN → 一次 LLM 调用产出 BRD。

import { buildDeepenQueries, analyzeBRD } from "../lib/brd.js";
import { gather } from "../lib/sources.js";
import { filterNoise } from "../lib/analyze.js";
import { costTracker } from "../lib/llm.js";

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
    if (!body.expansion || !body.expansion.englishSearchQuery) {
      return res.status(400).json({ error: "缺少 expansion 字段，请先调用 /api/expand" });
    }
    if (!process.env.LLM_API_KEY) {
      return res.status(500).json({ error: "服务器未配置 LLM_API_KEY 环境变量。" });
    }

    costTracker.reset();
    const expansion = body.expansion;

    const queries = buildDeepenQueries(expansion, input);
    let items = await gather(queries, { perQuery: 4, sinceDays: 540 });
    items = filterNoise(items);
    items = items.slice(0, 25);

    const brd = await analyzeBRD(input, items, { maxTokens: 3500 });
    if (brd.error) return res.status(200).json(brd);
    brd.input = input;
    brd.deepenQueries = queries;
    brd.deepenFetchedCount = items.length;
    brd.llmUsage = costTracker.summary();
    return res.status(200).json(brd);
  }

  try {
    await withTimeout(doWork(), 55_000);
  } catch (e) {
    if (!res.headersSent) {
      res.status(500).json({ error: e.message || "unknown error" });
    }
  }
}
