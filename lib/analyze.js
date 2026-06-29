// lib/analyze.js — 两步分析:① 扩词 ② 基于真实抓取语料的痛点分析。
// 关键原则:证据只能来自传入的真实条目(带真实 URL),不允许 LLM 编造。

import { callLLM, extractJSON } from "./llm.js";

const EXPAND_SYSTEM = `You expand a maker's product direction (Chinese or English) into realistic ENGLISH search expressions that foreign users actually type or say. Output ONLY one minified JSON object, no prose, no code fences:
{"englishSearchQuery":string,"keywords":string[],"relatedTerms":string[],"derivativeTerms":string[],"sourceHints":string[],"excludedTerms":string[]}
Rules: keywords/relatedTerms/derivativeTerms each at most 6 short items; prefer terms tied to pain, alternatives, or paying intent.`;

export async function expandQuery(input) {
  const text = await callLLM({
    system: EXPAND_SYSTEM,
    user: `Direction: "${input}"`,
    maxTokens: 600,
  });
  const json = extractJSON(text);
  return (
    json || {
      englishSearchQuery: input,
      keywords: [input],
      relatedTerms: [],
      derivativeTerms: [],
      sourceHints: [],
      excludedTerms: [],
    }
  );
}

// 从扩词结果挑出用于检索的查询词(去重、限量)
// 现在包含 derivativeTerms 和 sourceHints 以扩大搜索覆盖面
export function buildQueries(expansion, fallback) {
  const pool = [
    expansion.englishSearchQuery,
    ...(expansion.keywords || []),
    ...(expansion.relatedTerms || []),
    ...(expansion.derivativeTerms || []),
    ...(expansion.sourceHints || []),
  ].filter(Boolean);
  const uniq = [...new Set(pool.map((s) => s.trim()))].filter(Boolean);
  return uniq.length ? uniq.slice(0, 8) : [fallback];
}

// 用 excludedTerms 过滤抓取结果中的歧义内容
export function filterByExcluded(items, excludedTerms = []) {
  if (!excludedTerms.length) return items;
  const lowerExcluded = excludedTerms.map((t) => t.toLowerCase());
  return items.filter((item) => {
    const content = `${item.title || ""} ${item.text || ""}`.toLowerCase();
    return !lowerExcluded.some((ex) => content.includes(ex));
  });
}

// 噪音过滤：移除广告、榜单、目录站、机器人内容
const NOISE_PATTERNS = [
  /\b(top|best)\s+\d+\s+(tools|apps|software|websites|alternatives)/i,
  /\b(sponsored|advertisement|ad|promo|affiliate)\b/i,
  /\b(listicle|round-?up|comparison chart)\b/i,
  /\b(coupon|discount code|deal alert|flash sale)\b/i,
  /\[removed\]|\[deleted\]/i,
];

export function filterNoise(items) {
  return items.filter((item) => {
    const content = `${item.title || ""} ${item.text || ""}`;
    if (content.length < 15) return false;
    return !NOISE_PATTERNS.some((pat) => pat.test(content));
  });
}

function ANALYZE_SYSTEM(maxPains) {
  return `You are DemandRadar's analysis engine for solo makers hunting overseas (English-market) product opportunities.
You are given an INPUT direction and a CORPUS of REAL discussion items already fetched from communities (each has source, title, text, url). Analyze ONLY this corpus.

Do:
1. Cluster the corpus into distinct pain points.
2. For each: classify signalType (keyword|complaint|alternative|payment) and strength (weak|medium|strong); set frequency = how many corpus items support it; platformCount = how many distinct sources; isRealPain=true ONLY if frequency>=3 AND platformCount>=2.
3. Compute demandScore (0-100) and overallStrength (weak|medium|strong) from strength, repetition, cross-source spread, and payment signals.
4. decision: "GO"|"NO-GO"|"MIXED" + one-line decisionReason.
5. nextSearches: 3-4 concrete follow-up queries.

RULES:
- Evidence MUST come ONLY from the provided corpus. Use each item's real url. NEVER invent sources or URLs.
- Each evidence snippet is YOUR paraphrase, under 15 words, never copied text.
- Be skeptical: if the corpus is thin or off-topic, give a low score and weak strength, and say so.
- COMPACT: at most ${maxPains} pain points, at most 2 evidence items each.
- Output ONLY one minified JSON object, no markdown, no preamble:
{"input":string,"demandScore":number,"overallStrength":"weak"|"medium"|"strong","decision":"GO"|"NO-GO"|"MIXED","decisionReason":string,"painPoints":[{"title":string,"scenario":string,"signalType":"keyword"|"complaint"|"alternative"|"payment","strength":"weak"|"medium"|"strong","frequency":number,"platformCount":number,"isRealPain":boolean,"evidence":[{"source":string,"url":string,"snippet":string}]}],"signalMix":{"keyword":number,"complaint":number,"alternative":number,"payment":number},"nextSearches":string[]}`;
}

// 把语料压缩成紧凑文本,控制 token（提升上限到 50 条，截断到 300 字符）
function corpusToText(items, cap = 50) {
  return items
    .slice(0, cap)
    .map((it, i) => {
      const body = `${it.title || ""} ${it.text || ""}`.replace(/\s+/g, " ").slice(0, 300);
      const meta = [it.points != null ? `${it.points}pts` : "", it.comments != null ? `${it.comments}c` : ""]
        .filter(Boolean)
        .join("/");
      return `[${i + 1}] (${it.source}${meta ? ", " + meta : ""}) ${body} :: ${it.url}`;
    })
    .join("\n");
}

export async function analyzeCorpus(input, items, { maxPains = 3, maxTokens = 3000 } = {}) {
  if (!items.length) {
    return {
      input,
      demandScore: 0,
      overallStrength: "weak",
      decision: "NO-GO",
      decisionReason: "未抓到相关讨论,可能方向太窄或检索词不对。",
      painPoints: [],
      signalMix: { keyword: 0, complaint: 0, alternative: 0, payment: 0 },
      nextSearches: [],
    };
  }
  const user = `INPUT direction: "${input}"\n\nCORPUS (real fetched items):\n${corpusToText(items)}`;

  let text = await callLLM({ system: ANALYZE_SYSTEM(maxPains), user, maxTokens });
  let json = extractJSON(text);
  // 空响应或解析失败时重试一次：给更大的 token 预算（应对思考型模型把额度耗在推理上）
  if (!json || !json.painPoints) {
    text = await callLLM({ system: ANALYZE_SYSTEM(maxPains), user, maxTokens: Math.min(maxTokens + 2500, 6000) });
    json = extractJSON(text);
  }
  if (!json || !json.painPoints) {
    return { error: "parse_failed", raw: (text || "").slice(0, 1200) };
  }
  return json;
}
