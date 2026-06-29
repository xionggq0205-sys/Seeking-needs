// Vercel Serverless Function — GET /api/snapshot-diff?from=YYYY-MM-DD&to=YYYY-MM-DD
// 加载两份快照，按相似度匹配痛点，输出 new/heating/cooling/steady/gone 分桶。

import fs from "node:fs";
import path from "node:path";
import { diffSnapshots } from "../lib/trends.js";

function loadSnap(snapDir, date) {
  if (!date) return null;
  if (date === "latest") {
    const latestPath = path.join(process.cwd(), "data", "latest.json");
    if (!fs.existsSync(latestPath)) return null;
    const data = JSON.parse(fs.readFileSync(latestPath, "utf8"));
    if (data.placeholder) return null;
    return { ...data, date: "latest" };
  }
  const p = path.join(snapDir, `${date}.json`);
  if (!fs.existsSync(p)) return null;
  const data = JSON.parse(fs.readFileSync(p, "utf8"));
  return { ...data, date };
}

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const fromDate = (req.query?.from || "").toString();
    const toDate = (req.query?.to || "latest").toString();
    if (!fromDate) return res.status(400).json({ error: "缺少 from 参数" });

    const snapDir = path.join(process.cwd(), "data", "snapshots");
    const fromSnap = loadSnap(snapDir, fromDate);
    const toSnap = loadSnap(snapDir, toDate);
    if (!fromSnap) return res.status(404).json({ error: `找不到起点快照: ${fromDate}` });
    if (!toSnap) return res.status(404).json({ error: `找不到终点快照: ${toDate}` });

    const diff = diffSnapshots(fromSnap, toSnap);
    res.status(200).json(diff);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
