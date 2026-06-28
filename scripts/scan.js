// scripts/scan.js — 发现模式定时扫描。
// 运行(本地或 GitHub Actions):node scripts/scan.js
// 步骤:读狩猎场 → 抓最近 N 天讨论 → Claude 聚类痛点 → 对比历史快照标趋势 → 写 data/ 快照。

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { gather } from "../lib/sources.js";
import { analyzeCorpus } from "../lib/analyze.js";
import { annotateTrends } from "../lib/trends.js";

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
  const cfg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "config", "huntingground.json"), "utf8")
  );

  console.log(`[scan] theme: ${cfg.theme}`);
  console.log(`[scan] queries: ${cfg.queries.length}, subreddits: ${cfg.subreddits?.length || 0}`);

  // 抓取
  const items = await gather(cfg.queries, {
    subreddits: cfg.subreddits || [],
    perQuery: cfg.perQuery || 8,
    sinceDays: cfg.sinceDays || 7,
  });
  console.log(`[scan] fetched ${items.length} items`);

  // 分析
  const report = await analyzeCorpus(cfg.theme, items, {
    maxPains: cfg.maxPains || 6,
    maxTokens: 4000,
  });
  if (report.error) {
    console.error("[scan] analysis parse failed; aborting snapshot.");
    console.error((report.raw || "").slice(0, 400));
    process.exit(1);
  }

  // 趋势(对比历史快照)
  const history = loadHistory();
  const dated = {
    generatedAt: new Date().toISOString(),
    theme: cfg.theme,
    fetchedCount: items.length,
    ...report,
  };
  const withTrends = annotateTrends(dated, history);

  // 写快照(按日期)+ latest.json(前端读取)
  const dateKey = new Date().toISOString().slice(0, 10);
  fs.writeFileSync(
    path.join(SNAP_DIR, `${dateKey}.json`),
    JSON.stringify(withTrends, null, 2)
  );
  fs.writeFileSync(path.join(DATA_DIR, "latest.json"), JSON.stringify(withTrends, null, 2));

  const heating = withTrends.painPoints.filter((p) => p.trend === "heating").length;
  const fresh = withTrends.painPoints.filter((p) => p.trend === "new").length;
  console.log(`[scan] done. pains: ${withTrends.painPoints.length}, new: ${fresh}, heating: ${heating}`);
}

main().catch((e) => {
  console.error("[scan] fatal:", e.message);
  process.exit(1);
});
