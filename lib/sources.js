// lib/sources.js — 数据源适配器(可插拔)。
// Hacker News: 免费、无需密钥，开箱即用。
// Reddit: 免费层，需 OAuth(REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET)，未配置则自动跳过。
// 全部使用 Node18+ 全局 fetch，无第三方依赖。
// 支持：指数退避重试、结果缓存、段落级截断。

const UA = "DemandRadar/0.3 (self-use demand research)";

// ── 简易内存缓存（避免重复请求浪费配额）────────────────
const _cache = new Map();
const CACHE_TTL = 10 * 60 * 1000; // 10 分钟

function cacheGet(key) {
  const entry = _cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.ts > CACHE_TTL) {
    _cache.delete(key);
    return null;
  }
  return entry.data;
}

function cacheSet(key, data) {
  _cache.set(key, { data, ts: Date.now() });
}

// ── 指数退避重试 ─────────────────────────────────────
async function fetchWithRetry(url, options = {}, { retries = 2, baseDelay = 1000 } = {}) {
  for (let i = 0; i <= retries; i++) {
    try {
      const r = await fetch(url, options);
      if (r.ok) return r;
      if (r.status === 429 || r.status >= 500) {
        if (i === retries) return r;
        const delay = baseDelay * Math.pow(2, i);
        console.error(`[sources] ${r.status} from ${new URL(url).hostname}, ${delay}ms 后重试 (${i + 1}/${retries + 1})`);
        await new Promise((resolve) => setTimeout(resolve, delay));
        continue;
      }
      return r;
    } catch (e) {
      if (i === retries) throw e;
      const delay = baseDelay * Math.pow(2, i);
      console.error(`[sources] 网络错误: ${e.message}, ${delay}ms 后重试 (${i + 1}/${retries + 1})`);
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }
}

// ── 智能截断（按段落，不在句子中间切断）──────────────────
function smartTruncate(text, maxLen = 600) {
  if (!text || text.length <= maxLen) return text;
  const cut = text.slice(0, maxLen);
  const lastPeriod = Math.max(cut.lastIndexOf(". "), cut.lastIndexOf("。"), cut.lastIndexOf("\n"));
  if (lastPeriod > maxLen * 0.5) return cut.slice(0, lastPeriod + 1);
  return cut + "…";
}

// ── Hacker News（Algolia Search API）────────────────────
export async function searchHN(query, { sinceDays = 365, limit = 12 } = {}) {
  const cacheKey = `hn:${query}:${sinceDays}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

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
    const r = await fetchWithRetry(url, { headers: { "user-agent": UA } });
    if (!r.ok) return [];
    const data = await r.json();
    const results = (data.hits || []).map((h) => ({
      source: "Hacker News",
      title: h.title || h.story_title || "",
      text: (h.comment_text || h.story_text || "").replace(/<[^>]+>/g, " ").trim(),
      url: `https://news.ycombinator.com/item?id=${h.objectID}`,
      points: h.points ?? null,
      comments: h.num_comments ?? null,
      createdAt: h.created_at || null,
    }));
    cacheSet(cacheKey, results);
    return results;
  } catch (e) {
    console.error("[sources] HN error:", e.message);
    return [];
  }
}

// ── Reddit（免费层，app-only OAuth）──────────────────────
let _redditToken = null;
let _redditTokenExp = 0;

async function getRedditToken() {
  const id = process.env.REDDIT_CLIENT_ID;
  const secret = process.env.REDDIT_CLIENT_SECRET;
  if (!id || !secret) return null;
  if (_redditToken && Date.now() < _redditTokenExp) return _redditToken;

  const auth = Buffer.from(`${id}:${secret}`).toString("base64");
  const r = await fetchWithRetry("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${auth}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": UA,
    },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) {
    console.error("[sources] Reddit token error:", r.status);
    return null;
  }
  const data = await r.json();
  _redditToken = data.access_token;
  _redditTokenExp = Date.now() + (data.expires_in || 3600) * 1000 - 60000;
  return _redditToken;
}

export async function searchReddit(query, { subreddit = "", limit = 12 } = {}) {
  const cacheKey = `reddit:${subreddit}:${query}:${limit}`;
  const cached = cacheGet(cacheKey);
  if (cached) return cached;

  const token = await getRedditToken();
  if (!token) return [];
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
    const r = await fetchWithRetry(url, {
      headers: { authorization: `Bearer ${token}`, "user-agent": UA },
    });
    if (!r.ok) return [];
    const data = await r.json();
    const results = (data.data?.children || []).map((c) => {
      const d = c.data;
      return {
        source: `Reddit r/${d.subreddit}`,
        title: d.title || "",
        text: smartTruncate(d.selftext || "", 600),
        url: `https://www.reddit.com${d.permalink}`,
        points: d.score ?? null,
        comments: d.num_comments ?? null,
        createdAt: d.created_utc ? new Date(d.created_utc * 1000).toISOString() : null,
      };
    });
    cacheSet(cacheKey, results);
    return results;
  } catch (e) {
    console.error("[sources] Reddit error:", e.message);
    return [];
  }
}

// ── 统一采集：给定多个查询，从所有可用源拉取并去重 ───────────
export async function gather(queries, { subreddits = [], perQuery = 8, sinceDays = 365 } = {}) {
  const tasks = [];
  const sourceStatus = { hn: "ok", reddit: "ok" };

  for (const q of queries) {
    tasks.push(
      searchHN(q, { sinceDays, limit: perQuery }).catch((e) => {
        sourceStatus.hn = `error: ${e.message}`;
        return [];
      })
    );
    if (subreddits.length) {
      for (const sr of subreddits)
        tasks.push(
          searchReddit(q, { subreddit: sr, limit: perQuery }).catch((e) => {
            sourceStatus.reddit = `error: ${e.message}`;
            return [];
          })
        );
    } else {
      tasks.push(
        searchReddit(q, { limit: perQuery }).catch((e) => {
          sourceStatus.reddit = `error: ${e.message}`;
          return [];
        })
      );
    }
  }
  const results = await Promise.all(tasks);
  const flat = results.flat();

  const seen = new Set();
  const deduped = [];
  for (const item of flat) {
    if (!item.url || seen.has(item.url)) continue;
    if (!item.title && !item.text) continue;
    seen.add(item.url);
    deduped.push(item);
  }

  console.log(`[sources] 采集完成: queries=${queries.length}, raw=${flat.length}, deduped=${deduped.length}, status=${JSON.stringify(sourceStatus)}`);

  return deduped;
}
