// Vercel Serverless Function — POST /api/brd-ask
// 输入: { input, expansion, brd, question }
// 流程: 按问题构造小批查询 → 抓 HN → 一次 LLM 调用基于 BRD 上下文 + 新语料回答。

import { buildAskQueries, answerBRDQuestion } from "../lib/brdAsk.js";
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
    const question = (body.question || "").toString().trim();
    if (!input) return res.status(400).json({ error: "缺少 input 字段" });
    if (!question) return res.status(400).json({ error: "缺少 question 字段" });
    if (!body.brd || !body.brd.decision) return res.status(400).json({ error: "缺少 brd 字段，请先生成 BRD" });
    if (!body.expansion || !body.expansion.englishSearchQuery) return res.status(400).json({ error: "缺少 expansion 字段" });
    if (!process.env.LLM_API_KEY) return res.status(500).json({ error: "服务器未配置 LLM_API_KEY" });

    costTracker.reset();
    const queries = buildAskQueries(question, body.expansion, input);
    let items = [];
    if (queries.length) {
      items = await gather(queries, { perQuery: 4, sinceDays: 540 });
      items = filterNoise(items).slice(0, 18);
    }

    const result = await answerBRDQuestion({ input, brd: body.brd, question, items, maxTokens: 1800 });
    if (result.error) return res.status(200).json(result);
    result.queries = queries;
    result.corpusCount = items.length;
    result.llmUsage = costTracker.summary();
    return res.status(200).json(result);
  }

  try {
    await withTimeout(doWork(), 50_000);
  } catch (e) {
    if (!res.headersSent) res.status(500).json({ error: e.message || "unknown error" });
  }
}
