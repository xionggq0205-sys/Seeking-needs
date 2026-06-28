import { expandQuery } from "../lib/analyze.js";
import { costTracker } from "../lib/llm.js";

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
      res.status(500).json({ error: "服务器未配置 LLM_API_KEY 环境变量。请在 Vercel 项目 Settings → Environment Variables 中添加 LLM_API_KEY。" });
      return;
    }
    costTracker.reset();
    const expansion = await expandQuery(input);
    res.status(200).json({ expansion, llmUsage: costTracker.summary() });
  } catch (e) {
    res.status(500).json({ error: e.message || "unknown error" });
  }
}
