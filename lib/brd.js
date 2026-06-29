// lib/brd.js — BRD 深度分析。基于聚焦在「竞品 / 定价 / 替代品 / 评测」的语料,
// 一次 LLM 调用产出商业需求文档结构化输出。证据严格来自抓取的真实条目。

import { callLLM, extractJSON } from "./llm.js";

// 在原始 expansion 基础上构造「深挖型」查询：竞品、定价、替代品、评测
export function buildDeepenQueries(expansion, input) {
  const base = expansion.englishSearchQuery || input;
  const trimmed = base.trim();
  const queries = [
    `${trimmed} alternative`,
    `${trimmed} pricing`,
    `${trimmed} vs`,
    `${trimmed} review`,
  ];
  // 加入原扩词里的关键词，做一次「best X」「X comparison」类查询提高覆盖
  const kw = (expansion.keywords || [])[0];
  if (kw && kw !== trimmed) queries.push(`best ${kw}`);
  return [...new Set(queries.map((q) => q.trim()).filter(Boolean))].slice(0, 5);
}

const BRD_SYSTEM = `You are DemandRadar's BRD (Business Requirements Doc) analysis engine for solo makers hunting overseas markets.
You receive an INPUT direction and a CORPUS of REAL discussion items focused on competitors, pricing, alternatives, and reviews.
Produce a structured BRD analysis grounded in the corpus.

Output ONLY one minified JSON, no markdown, no preamble:
{
  "competitors": [{"name":string,"url":string|null,"positioning":string,"weakness":string,"evidence":[{"source":string,"url":string,"snippet":string}]}],
  "persona": {"description":string,"painLevel":"low"|"medium"|"high","alternativesTried":string[],"willingnessToPay":"unknown"|"low"|"medium"|"high","quotes":[{"source":string,"url":string,"snippet":string}]},
  "marketSize": {"signal":"tiny"|"niche"|"broad"|"massive","reasoning":string,"indicators":string[]},
  "pricing": {"benchmarks":[{"competitor":string,"plan":string,"price":string}],"suggested":{"model":string,"range":string,"reasoning":string}},
  "decision": {"verdict":"GO"|"NO-GO"|"MIXED","confidence":number,"risks":string[],"opportunities":string[],"nextSteps":string[]}
}

RULES:
- Evidence MUST come from the provided corpus. Use real URLs. NEVER fabricate sources, prices, or competitors.
- Each snippet is YOUR paraphrase under 18 words, never copied text.
- If signal is thin (no pricing seen, no clear competitors, etc.), be honest: empty arrays, "unknown", low confidence, and say why in the relevant reasoning field.
- COMPACT: at most 3 competitors (2 evidence each), at most 3 persona quotes, at most 3 risks/opportunities/nextSteps.
- positioning, weakness, description, reasoning fields: each under 30 words.
- pricing.suggested.range: a concrete dollar range like "$5-15/mo" or "one-time $29-49"; if you can't infer, set range to "unknown" and explain in reasoning.
- decision.confidence: 0-100. Below 40 means "evidence too thin to decide".`;

function corpusToText(items, cap = 40) {
  return items
    .slice(0, cap)
    .map((it, i) => {
      const body = `${it.title || ""} ${it.text || ""}`.replace(/\s+/g, " ").slice(0, 320);
      const meta = [it.points != null ? `${it.points}pts` : "", it.comments != null ? `${it.comments}c` : ""]
        .filter(Boolean)
        .join("/");
      return `[${i + 1}] (${it.source}${meta ? ", " + meta : ""}) ${body} :: ${it.url}`;
    })
    .join("\n");
}

export async function analyzeBRD(input, items, { maxTokens = 4000 } = {}) {
  if (!items.length) {
    return {
      input,
      thin: true,
      reason: "未抓到「竞品 / 定价 / 评测」相关讨论，无法生成 BRD。",
      competitors: [],
      persona: { description: "", painLevel: "low", alternativesTried: [], willingnessToPay: "unknown", quotes: [] },
      marketSize: { signal: "tiny", reasoning: "缺乏数据", indicators: [] },
      pricing: { benchmarks: [], suggested: { model: "unknown", range: "unknown", reasoning: "缺乏数据" } },
      decision: { verdict: "MIXED", confidence: 0, risks: ["证据不足，无法形成结论"], opportunities: [], nextSteps: ["扩大查询词或换关键词后重试"] },
    };
  }

  const user = `INPUT direction: "${input}"\n\nCORPUS (real fetched items, focused on competitors/pricing/alternatives/reviews):\n${corpusToText(items)}`;

  let text = await callLLM({ system: BRD_SYSTEM, user, maxTokens });
  let json = extractJSON(text);
  if (!json || !json.decision) {
    text = await callLLM({ system: BRD_SYSTEM, user, maxTokens: Math.min(maxTokens + 2000, 6000) });
    json = extractJSON(text);
  }
  if (!json || !json.decision) {
    return { error: "parse_failed", raw: (text || "").slice(0, 1200) };
  }
  return json;
}
