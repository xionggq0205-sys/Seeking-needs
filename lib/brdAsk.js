// lib/brdAsk.js — BRD 追问。基于已生成的 BRD 上下文 + 针对问题抓的新一小批语料,
// 一次 LLM 调用产出简短可引用的回答。

import { callLLM, extractJSON } from "./llm.js";

export function buildAskQueries(question, expansion, input) {
  const base = (expansion.englishSearchQuery || input || "").trim();
  const q = (question || "").trim();
  if (!q) return [];
  // 简单策略：把问题中的英文/中文关键词与方向词拼一起；再额外抓一条只用问题本身
  const combined = `${base} ${q}`.slice(0, 100);
  const queries = [combined];
  if (q.length >= 5 && q.length <= 80) queries.push(q);
  // 如果问题里提到了某个具体竞品/词，加一条带定位的查询
  const lower = q.toLowerCase();
  if (/pric|cost|fee|价格|定价|多少钱|费用/.test(lower)) queries.push(`${base} pricing review`);
  if (/aliv|altern|vs|替代|换/.test(lower)) queries.push(`${base} alternative comparison`);
  if (/who|user|persona|画像|用户|customer|客户/.test(lower)) queries.push(`${base} who uses why`);
  return [...new Set(queries.map((s) => s.trim()).filter(Boolean))].slice(0, 3);
}

const ASK_SYSTEM = `You are DemandRadar's BRD follow-up assistant for a solo maker.

Given:
- A direction the user is validating
- The structured BRD already produced (competitors, persona, market, pricing, decision)
- A small CORPUS of real discussion items focused on the user's question
- The user's question (may be in Chinese or English)

Answer the question concisely, grounded in the BRD context and corpus.

Output ONLY one minified JSON, no markdown, no preamble:
{
  "answer": string (<160 words; you MAY reference items as [1], [2] etc.; answer in the user's language),
  "citations": [{"index": number, "source": string, "url": string, "snippet": string}],
  "confidence": "low"|"medium"|"high"
}

RULES:
- The answer must be SPECIFIC and ACTIONABLE for a solo maker. Do not repeat the BRD verbatim.
- citations: only include items from the corpus that you actually used; each snippet ≤18 words, your paraphrase, never copied text.
- If the corpus + BRD don't support an answer, set confidence "low" and say "证据不足：[explain what's missing]". Don't fabricate.
- Index numbers in citations must match the [N] markers in your answer.
- At most 4 citations.`;

function brdSummary(brd) {
  if (!brd) return "(no BRD)";
  const d = brd.decision || {};
  const p = brd.persona || {};
  const m = brd.marketSize || {};
  const pr = brd.pricing || {};
  const sg = pr.suggested || {};
  const comps = (brd.competitors || []).map((c) => `${c.name}（定位:${c.positioning||"–"}; 弱点:${c.weakness||"–"}）`).join("； ");
  return [
    `决策: ${d.verdict || "–"} 置信度 ${d.confidence ?? "–"}/100`,
    `风险: ${(d.risks || []).join(" | ")}`,
    `机会: ${(d.opportunities || []).join(" | ")}`,
    `下一步: ${(d.nextSteps || []).join(" | ")}`,
    `画像: ${p.description || "–"} (痛点 ${p.painLevel || "–"} / 付费意愿 ${p.willingnessToPay || "–"})`,
    `市场: ${m.signal || "–"} - ${m.reasoning || "–"}`,
    `定价建议: ${sg.range || "–"} (${sg.model || "–"}) - ${sg.reasoning || "–"}`,
    `竞品: ${comps || "–"}`,
  ].join("\n");
}

function corpusToText(items, cap = 18) {
  return items
    .slice(0, cap)
    .map((it, i) => {
      const body = `${it.title || ""} ${it.text || ""}`.replace(/\s+/g, " ").slice(0, 280);
      const meta = [it.points != null ? `${it.points}pts` : "", it.comments != null ? `${it.comments}c` : ""].filter(Boolean).join("/");
      return `[${i + 1}] (${it.source}${meta ? ", " + meta : ""}) ${body} :: ${it.url}`;
    })
    .join("\n");
}

export async function answerBRDQuestion({ input, brd, question, items, maxTokens = 2000 }) {
  const user =
    `DIRECTION: "${input}"\n\n` +
    `BRD CONTEXT:\n${brdSummary(brd)}\n\n` +
    `CORPUS for this question:\n${items && items.length ? corpusToText(items) : "(no fresh corpus; rely on BRD context only)"}\n\n` +
    `USER QUESTION: ${question}`;

  let text = await callLLM({ system: ASK_SYSTEM, user, maxTokens });
  let json = extractJSON(text);
  if (!json || typeof json.answer !== "string") {
    text = await callLLM({ system: ASK_SYSTEM, user, maxTokens: Math.min(maxTokens + 1500, 4000) });
    json = extractJSON(text);
  }
  if (!json || typeof json.answer !== "string") {
    return { error: "parse_failed", raw: (text || "").slice(0, 800) };
  }
  return json;
}
