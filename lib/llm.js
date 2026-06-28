// lib/llm.js — 调用兼容 OpenAI 接口的大模型（DeepSeek / Kimi / 通义千问等）。
// 无第三方依赖，使用 Node18+ 全局 fetch。
// 支持主模型 + 备用模型自动切换、单次 token 上限、月度预算追踪。
//
// 环境变量:
//   LLM_API_KEY       必填，模型 API Key
//   LLM_BASE_URL      可选，默认 https://api.deepseek.com
//   LLM_MODEL         可选，默认 deepseek-v4-flash
//   LLM_BACKUP_KEY    可选，备用模型 API Key
//   LLM_BACKUP_URL    可选，备用模型 Base URL
//   LLM_BACKUP_MODEL  可选，备用模型名称

// ── 成本追踪 ──────────────────────────────────────────
const costTracker = {
  callCount: 0,
  totalTokens: 0,
  sessionCalls: 0,
  maxCallsPerRun: parseInt(process.env.LLM_MAX_CALLS_PER_RUN || "20", 10),
  maxTokensPerRun: parseInt(process.env.LLM_MAX_TOKENS_PER_RUN || "100000", 10),
  reset() {
    this.sessionCalls = 0;
    this.totalTokens = 0;
  },
  record(tokens) {
    this.callCount++;
    this.sessionCalls++;
    this.totalTokens += tokens;
  },
  checkBudget() {
    if (this.sessionCalls >= this.maxCallsPerRun) {
      throw new Error(`成本护栏触发：单次运行 LLM 调用次数已达上限 ${this.maxCallsPerRun}`);
    }
    if (this.totalTokens >= this.maxTokensPerRun) {
      throw new Error(`成本护栏触发：单次运行 token 用量已达上限 ${this.maxTokensPerRun}`);
    }
  },
  summary() {
    return { calls: this.sessionCalls, tokens: this.totalTokens };
  },
};

export { costTracker };

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

// ── 指数退避重试 ──────────────────────────────────────
async function withRetry(fn, { retries = 2, baseDelay = 1000 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      return await fn();
    } catch (e) {
      if (i === retries) throw e;
      const delay = baseDelay * Math.pow(2, i);
      console.error(`LLM 调用失败 (尝试 ${i + 1}/${retries + 1}): ${e.message}，${delay}ms 后重试`);
      await new Promise((r) => setTimeout(r, delay));
    }
  }
}

async function callOnce({ system, user, maxTokens, baseUrl, model, key }) {
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), 25_000);
  let r;
  try {
    r = await fetch(`${baseUrl}/chat/completions`, {
      method: "POST",
      signal: ac.signal,
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
  } catch (e) {
    clearTimeout(timer);
    if (e.name === "AbortError") throw new Error("LLM 请求超时(25s)");
    throw e;
  }
  clearTimeout(timer);

  if (!r.ok) {
    const detail = await r.text();
    throw new Error(`模型接口 ${r.status}: ${detail.slice(0, 300)}`);
  }
  const data = await r.json();
  const usage = data?.usage || {};
  costTracker.record(usage.total_tokens || usage.completion_tokens || 0);
  const content = data?.choices?.[0]?.message?.content;
  return typeof content === "string" ? content : "";
}

export async function callLLM({ system, user, maxTokens = 2000 }) {
  costTracker.checkBudget();

  const key = process.env.LLM_API_KEY;
  if (!key) throw new Error("缺少 LLM_API_KEY 环境变量");
  const baseUrl = (process.env.LLM_BASE_URL || "https://api.deepseek.com").replace(/\/+$/, "");
  const model = process.env.LLM_MODEL || "deepseek-v4-flash";

  try {
    return await withRetry(() => callOnce({ system, user, maxTokens, baseUrl, model, key }), { retries: 1 });
  } catch (primaryErr) {
    const backupKey = process.env.LLM_BACKUP_KEY;
    if (!backupKey) throw primaryErr;

    console.error(`主模型失败，切换备用模型: ${primaryErr.message}`);
    const backupUrl = (process.env.LLM_BACKUP_URL || baseUrl).replace(/\/+$/, "");
    const backupModel = process.env.LLM_BACKUP_MODEL || model;
    return await withRetry(() =>
      callOnce({ system, user, maxTokens, baseUrl: backupUrl, model: backupModel, key: backupKey }),
      { retries: 1 }
    );
  }
}
