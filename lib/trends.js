// lib/trends.js — 趋势判定:把最新快照与历史快照对比,标注每个痛点的冷热变化。
// 用归一化标题做近似匹配(轻量、确定性,不追求完美聚类)。

function normalize(s) {
  return (s || "")
    .toLowerCase()
    .replace(/[^a-z0-9\u4e00-\u9fa5\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// 两个标题的词级 Jaccard 相似度
function similarity(a, b) {
  const sa = new Set(normalize(a).split(" ").filter(Boolean));
  const sb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!sa.size || !sb.size) return 0;
  let inter = 0;
  for (const w of sa) if (sb.has(w)) inter++;
  return inter / (sa.size + sb.size - inter);
}

function bestMatch(pain, candidates, threshold = 0.34) {
  let best = null;
  let bestScore = 0;
  for (const c of candidates) {
    const s = similarity(pain.title, c.title);
    if (s > bestScore) {
      bestScore = s;
      best = c;
    }
  }
  return bestScore >= threshold ? best : null;
}

const STRENGTH_RANK = { weak: 1, medium: 2, strong: 3 };

/**
 * @param {object} latest         最新快照 { painPoints:[...] }
 * @param {object[]} history      历史快照数组(不含 latest),按时间任意顺序
 * @returns 给 latest.painPoints 每项加上 { trend, scoreDelta, sourceDelta }
 */
export function annotateTrends(latest, history = []) {
  // 取最近一次历史快照作为主要对比对象
  const sorted = [...history].sort((a, b) =>
    (b.generatedAt || "").localeCompare(a.generatedAt || "")
  );
  const prev = sorted[0];
  const prevPains = prev?.painPoints || [];
  // 全部历史里出现过的痛点(用于判断"是否真的新")
  const allPrevPains = sorted.flatMap((s) => s.painPoints || []);

  const painPoints = (latest.painPoints || []).map((p) => {
    const everSeen = bestMatch(p, allPrevPains);
    if (!everSeen) {
      return { ...p, trend: "new", scoreDelta: null, sourceDelta: null };
    }
    const match = bestMatch(p, prevPains) || everSeen;
    const scoreDelta =
      (STRENGTH_RANK[p.strength] || 0) - (STRENGTH_RANK[match.strength] || 0);
    const sourceDelta = (p.platformCount || 0) - (match.platformCount || 0);
    let trend = "steady";
    if (scoreDelta > 0 || sourceDelta > 0) trend = "heating";
    else if (scoreDelta < 0 || sourceDelta < 0) trend = "cooling";
    return { ...p, trend, scoreDelta, sourceDelta };
  });

  return { ...latest, painPoints };
}

/**
 * 比较任意两个快照 from→to,产出按 trend 分桶的痛点列表。
 * @param {object} from 起点快照 { painPoints, theme, generatedAt }
 * @param {object} to   终点快照 { painPoints, theme, generatedAt }
 * @returns {{from, to, painPoints: [...]}}
 *  painPoints 项含 trend: "new" | "heating" | "cooling" | "steady" | "gone"
 *  - new: 在 to 中存在,from 中无对应项
 *  - heating/cooling: 两边都有,但强度或平台数变化
 *  - steady: 两边都有,无显著变化
 *  - gone: 在 from 中存在,to 中无对应项(保留原数据,scoreDelta/sourceDelta 为负)
 */
export function diffSnapshots(from, to) {
  const fromPains = from?.painPoints || [];
  const toPains = to?.painPoints || [];

  // 标注 to 端每个痛点的 trend
  const annotatedTo = toPains.map((p) => {
    const match = bestMatch(p, fromPains);
    if (!match) {
      return { ...p, trend: "new", scoreDelta: null, sourceDelta: null };
    }
    const scoreDelta =
      (STRENGTH_RANK[p.strength] || 0) - (STRENGTH_RANK[match.strength] || 0);
    const sourceDelta = (p.platformCount || 0) - (match.platformCount || 0);
    let trend = "steady";
    if (scoreDelta > 0 || sourceDelta > 0) trend = "heating";
    else if (scoreDelta < 0 || sourceDelta < 0) trend = "cooling";
    return { ...p, trend, scoreDelta, sourceDelta };
  });

  // 找 from 中没在 to 出现的(已消失)
  const gone = fromPains
    .filter((p) => !bestMatch(p, toPains))
    .map((p) => ({ ...p, trend: "gone", scoreDelta: null, sourceDelta: null }));

  return {
    from: { date: from?.date || null, theme: from?.theme || "", generatedAt: from?.generatedAt || null },
    to:   { date: to?.date   || null, theme: to?.theme   || "", generatedAt: to?.generatedAt   || null },
    painPoints: [...annotatedTo, ...gone],
  };
}
