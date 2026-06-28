import { callLLM, costTracker } from "../lib/llm.js";

export const config = { maxDuration: 30 };

export default async function handler(req, res) {
  const start = Date.now();
  try {
    costTracker.reset();
    const result = await callLLM({
      system: "Reply with a single JSON object: {\"test\": true}",
      user: "Hello",
      maxTokens: 50,
    });
    res.status(200).json({
      ok: true,
      ms: Date.now() - start,
      result: result.slice(0, 200),
      usage: costTracker.summary(),
    });
  } catch (e) {
    res.status(200).json({
      ok: false,
      ms: Date.now() - start,
      error: e.message,
      stack: e.stack?.slice(0, 500),
    });
  }
}
