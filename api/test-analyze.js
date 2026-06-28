import { expandQuery, buildQueries, analyzeCorpus, filterByExcluded, filterNoise } from "../lib/analyze.js";
import { gather } from "../lib/sources.js";
import { costTracker } from "../lib/llm.js";

export const config = { maxDuration: 60 };

export default async function handler(req, res) {
  const steps = [];
  try {
    steps.push("start");
    costTracker.reset();
    steps.push("costTracker.reset ok");

    const input = "epub converter";

    steps.push("calling expandQuery...");
    const expansion = await expandQuery(input);
    steps.push("expandQuery ok: " + JSON.stringify(expansion).slice(0, 200));

    steps.push("calling buildQueries...");
    const queries = buildQueries(expansion, input);
    steps.push("buildQueries ok: " + JSON.stringify(queries));

    steps.push("calling gather...");
    const items = await gather(queries, { perQuery: 3, sinceDays: 180 });
    steps.push("gather ok: " + items.length + " items");

    const filtered = filterNoise(filterByExcluded(items, expansion.excludedTerms));
    steps.push("filter ok: " + filtered.length + " items after filter");

    steps.push("calling analyzeCorpus...");
    const report = await analyzeCorpus(input, filtered, { maxPains: 2 });
    steps.push("analyzeCorpus ok");

    res.status(200).json({ ok: true, steps, report });
  } catch (e) {
    steps.push("ERROR: " + e.message);
    res.status(200).json({ ok: false, steps, error: e.message, stack: e.stack?.slice(0, 500) });
  }
}
