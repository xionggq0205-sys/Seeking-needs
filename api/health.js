export default function handler(req, res) {
  res.status(200).json({
    ok: true,
    node: process.version,
    hasFetch: typeof fetch !== "undefined",
    env: {
      hasLLMKey: !!process.env.LLM_API_KEY,
      llmBaseUrl: process.env.LLM_BASE_URL || "(default: deepseek)",
      llmModel: process.env.LLM_MODEL || "(default: deepseek-v4-flash)",
    },
  });
}
