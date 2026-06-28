// Vercel Serverless Function — GET /api/snapshots
// 返回可用的历史快照列表（日期 + 主题），供前端历史浏览用。

import fs from "node:fs";
import path from "node:path";

export default function handler(req, res) {
  if (req.method !== "GET") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }
  try {
    const snapDir = path.join(process.cwd(), "data", "snapshots");
    if (!fs.existsSync(snapDir)) {
      res.status(200).json({ snapshots: [] });
      return;
    }
    const files = fs.readdirSync(snapDir)
      .filter((f) => f.endsWith(".json") && !f.includes("-raw"))
      .sort()
      .reverse();

    const snapshots = files.map((f) => {
      try {
        const data = JSON.parse(fs.readFileSync(path.join(snapDir, f), "utf8"));
        return {
          file: f,
          date: f.replace(".json", ""),
          theme: data.theme || "",
          painCount: (data.painPoints || []).length,
          fetchedCount: data.fetchedCount || 0,
          generatedAt: data.generatedAt || null,
        };
      } catch {
        return { file: f, date: f.replace(".json", ""), theme: "", painCount: 0 };
      }
    });

    res.status(200).json({ snapshots });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
