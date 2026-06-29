// scripts/scan.js — 发现模式定时扫描。
// 运行(本地或 GitHub Actions): node scripts/scan.js

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gather } from "../lib/sources.js";
import { analyzeCorpus, filterNoise } from "../lib/analyze.js";
import { annotateTrends } from "../lib/trends.js";
import { costTracker } from "../lib/llm.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const DATA_DIR = path.join(ROOT, "data");
const SNAP_DIR = path.join(DATA_DIR, "snapshots");

function ensureDirs() {
  fs.mkdirSync(SNAP_DIR, { recursive: true });
}

function loadHistory() {
  if (!fs.existsSync(SNAP_DIR)) return [];
  return fs
    .readdirSync(SNAP_DIR)
    .filter((f) => f.endsWith(".json"))
    .map((f) => {
      try {
        return JSON.parse(fs.readFileSync(path.join(SNAP_DIR, f), "utf8"));
      } catch {
        return null;
      }
    })
    .filter(Boolean);
}

async function main() {
  ensureDirs();
  costTracker.reset();

  const cfg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config", "huntingground.json"), "utf8")
  );

  console.log(`[scan] theme: ${cfg.theme}`);
  console.log(`[scan] queries: ${cfg.queries.length}, subreddits: ${cfg.subreddits?.length || 0}`);

  const items = await gather(cfg.queries, {
    subreddits: cfg.subreddits || [],
    perQuery: cfg.perQuery || 8,
    sinceDays: cfg.sinceDays || 7,
    includeReddit: true, // 定时扫描跑在 GitHub Actions，无 12s 限制；配了 Reddit 密钥才实际生效
  });
  console.log(`[scan] fetched ${items.length} items`);

  // 先保存原始数据，分析失败时仍可恢复
  const dateKey = new Date().toISOString().slice(0, 10);
  const rawPath = path.join(SNAP_DIR, `${dateKey}-raw.json`);
  fs.writeFileSync(rawPath, JSON.stringify({ fetchedAt: new Date().toISOString(), items }, null, 2));
  console.log(`[scan] raw data saved: ${rawPath}`);

  const cleaned = filterNoise(items);
  console.log(`[scan] after noise filter: ${cleaned.length} items (removed ${items.length - cleaned.length})`);

  const report = await analyzeCorpus(cfg.theme, cleaned, {
    maxPains: cfg.maxPains || 6,
    maxTokens: 4000,
  });
  if (report.error) {
    console.error("[scan] analysis parse failed; raw data preserved at", rawPath);
    console.error((report.raw || "").slice(0, 400));
    process.exit(1);
  }

  const history = loadHistory();
  const dated = {
    generatedAt: new Date().toISOString(),
    theme: cfg.theme,
    fetchedCount: cleaned.length,
    llmUsage: costTracker.summary(),
    ...report,
  };
  const withTrends = annotateTrends(dated, history);

  fs.writeFileSync(
    path.join(SNAP_DIR, `${dateKey}.json`),
    JSON.stringify(withTrends, null, 2)
  );
  fs.writeFileSync(path.join(DATA_DIR, "latest.json"), JSON.stringify(withTrends, null, 2));

  const heating = withTrends.painPoints.filter((p) => p.trend === "heating").length;
  const fresh = withTrends.painPoints.filter((p) => p.trend === "new").length;
  console.log(`[scan] done. pains: ${withTrends.painPoints.length}, new: ${fresh}, heating: ${heating}`);
  console.log(`[scan] LLM usage:`, JSON.stringify(costTracker.summary()));
}

main().catch((e) => {
  console.error("[scan] fatal:", e.message);
  process.exit(1);
});
