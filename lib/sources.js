// lib/sources.js — 数据源适配器(可插拔)。
// Hacker News:免费、无需密钥,开箱即用。
// Reddit:免费层,需 OAuth(REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET),未配置则自动跳过。
// 全部使用 Node18+ 全局 fetch,无第三方依赖。

const UA = "DemandRadar/0.2 (self-use demand research)";

// ── Hacker News(Algolia Search API)────────────────────────
// 文档:https://hn.algolia.com/api
export async function searchHN(query, { sinceDays = 365, limit = 12 } = {}) {
  const sinceTs = Math.floor(Date.now() / 1000) - sinceDays * 86400;
  const url =
    "https://hn.algolia.com/api/v1/search?" +
    new URLSearchParams({
      query,
      tags: "(story,comment)",
      numericFilters: `created_at_i>${sinceTs}`,
      hitsPerPage: String(limit),
    });
  try {
    const r = await fetch(url, { headers: { "user-agent": UA } });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.hits || []).map((h) => ({
      source: "Hacker News",
      title: h.title || h.story_title || "",
      text: (h.comment_text || h.story_text || "").replace(/<[^>]+>/g, " ").trim(),
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points ?? null,
      comments: h.num_comments ?? null,
      createdAt: h.created_at || null,
    }));
  } catch (e) {
    console.error("HN error:", e.message);
    return [];
  }
}

// ── Reddit(免费层,app-only OAuth)──────────────────────────
let _redditToken = null;
let _redditTokenExp = 0;

async function getRedditToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null; // 未配置 → 跳过 Reddit
  if (_redditToken && Date.now() < _redditTokenExp) return _redditToken;

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetch("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) {
    console.error("Reddit token error:", r.status);
    return null;
  }
  const data = await r.json();
  _redditToken = data.access_token;
  _redditTokenExp = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
  return _redditToken;
}

export async function searchReddit(query, { subreddit = "", limit = 12 } = {}) {
  const token = await getRedditToken();
  if (!token) return []; // 未配置或取 token 失败 → 安静跳过
  const base = subreddit
    ? `https://oauth.reddit.com/r/${subreddit}/search`
    : "https://oauth.reddit.com/search";
  const url =
    base +
    "?" +
    new URLSearchParams({
      q: query,
      limit: String(limit),
      sort: "relevance",
      t: "year",
      restrict_sr: subreddit ? "true" : "false",
    });
  try {
    const r = await fetch(url, {
      headers: { authorization: `Bearer ${token}`, "user-agent": UA },
    });
    if (!r.ok) return [];
    const data = await r.json();
    return (data.data?.children || []).map((c) => {
      const d = c.data;
      return {
        source: `Reddit r/${d.subreddit}`,
        title: d.title || "",
        text: (d.selftext || "").slice(0, 600),
        url: `https://www.reddit.com${d.permalink}`,
        points: d.score ?? null,
        comments: d.num_comments ?? null,
        createdAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
      };
    });
  } catch (e) {
    console.error("Reddit error:", e.message);
    return [];
  }
}

// ── 统一采集:给定多个查询,从所有可用源拉取并去重 ───────────
export async function gather(queries, { subreddits = [], perQuery = 8, sinceDays = 365 } = {}) {
  const tasks = [];
  for (const q of queries) {
    tasks.push(searchHN(q, { sinceDays, limit: perQuery }));
    if (subreddits.length) {
      for (const sr of subreddits) tasks.push(searchReddit(q, { subreddit: sr, limit: perQuery }));
    } else {
      tasks.push(searchReddit(q, { limit: perQuery }));
    }
  }
  const results = await Promise.all(tasks);
  const flat = results.flat();

  // 按 url 去重
  const seen = new Set();
  const deduped = [];
  for (const item of flat) {
    if (!item.url || seen.has(item.url)) continue;
    if (!item.title && !item.text) continue;
    seen.add(item.url);
    deduped.push(item);
  }
  return deduped;
}
