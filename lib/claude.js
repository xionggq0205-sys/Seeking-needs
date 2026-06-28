// lib/claude.js — 调用「兼容 OpenAI 接口」的大模型。
// 默认走 DeepSeek;换成任意兼容 OpenAI 的国产模型(Kimi / 通义千问等)只需改 3 个环境变量。
// 无第三方依赖,使用 Node18+ 全局 fetch。
//
// 环境变量:
//   LLM_API_KEY    必填,你的模型 API Key
//   LLM_BASE_URL   可选,默认 https://api.deepseek.com
//   LLM_MODEL      可选,默认 deepseek-v4-flash

export function extractJSON(text) {
  if (!text) return null;
  const t = text.replace(/```json/gi, "").replace(/```/g, "").trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

export async function callClaude({ system, user, maxTokens = 2000 }) {
  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error("缺少 LLM_API_KEY 环境变量");
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || "deepseek-v4-flash";

  const r = await fetch(`${baseUrl}/chat/completions`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${key}`,
    },
    body: JSON.stringify({
      model,
      max_tokens: maxTokens,
      temperature: 0.3,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
    }),
  });

  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`模型接口 ${r.status}: ${detail.slice(0, 300)}`);
  }
  const data = await r.json();
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}
