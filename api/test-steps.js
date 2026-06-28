import { expandQuery, buildQueries, analyzeCorpus, filterByExcluded, filterNoise } from "../lib/analyze.js";
import { gather } from "../lib/sources.js";
import { costTracker } from "../lib/llm.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const step = new URL(req.url, "http://localhost").searchParams.get("step") || "expand";
  const t0 = Date.now();
  const input = "epub converter";
  try {
    costTracker.reset();

    if (step === "expand") {
      const expansion = await expandQuery(input);
      return res.status(200).json({ ok: true, step, ms: Date.now() - t0, expansion });
    }

    if (step === "gather") {
      const queries = [input, "epub convert tool"];
      const items = await gather(queries, { perQuery: 3, sinceDays: 180 });
      return res.status(200).json({ ok: true, step, ms: Date.now() - t0, count: items.length, sample: items.slice(0, 2) });
    }

    if (step === "analyze") {
      const fakeItems = [
        { source: "Hacker News", title: "Best epub converter?", text: "I need to convert epub to pdf, calibre is too slow", url: "https://hn.example.com/1", points: 42, comments: 15 },
        { source: "Hacker News", title: "Epub tools comparison", text: "Looking for alternatives to calibre for batch epub conversion", url: "https://hn.example.com/2", points: 28, comments: 8 },
      ];
      const report = await analyzeCorpus(input, fakeItems, { maxPains: 2, maxTokens: 1500 });
      return res.status(200).json({ ok: true, step, ms: Date.now() - t0, report });
    }

    if (step === "two-llm") {
      const expansion = await expandQuery(input);
      const t1 = Date.now();
      const fakeItems = [
        { source: "Hacker News", title: "Best epub converter?", text: "I need to convert epub to pdf, calibre is too slow", url: "https://hn.example.com/1", points: 42, comments: 15 },
      ];
      const report = await analyzeCorpus(input, fakeItems, { maxPains: 1, maxTokens: 1000 });
      return res.status(200).json({ ok: true, step, expandMs: t1 - t0, analyzeMs: Date.now() - t1, totalMs: Date.now() - t0 });
    }

    if (step === "full") {
      const expansion = await expandQuery(input);
      const t1 = Date.now();
      const queries = buildQueries(expansion, input);
      const items = await gather(queries.slice(0, 3), { perQuery: 3, sinceDays: 180 });
      const t2 = Date.now();
      const filtered = filterNoise(filterByExcluded(items, expansion.excludedTerms));
      const report = await analyzeCorpus(input, filtered, { maxPains: 2, maxTokens: 1500 });
      return res.status(200).json({
        ok: true, step,
        expandMs: t1 - t0, gatherMs: t2 - t1, analyzeMs: Date.now() - t2, totalMs: Date.now() - t0,
        queriesUsed: queries.slice(0, 3).length, fetchedCount: items.length, filteredCount: filtered.length,
      });
    }

    res.status(400).json({ error: "step must be: expand|gather|analyze|full" });
  } catch (e) {
    res.status(200).json({ ok: false, step, ms: Date.now() - t0, error: e.message, stack: e.stack?.slice(0, 300) });
  }
}
