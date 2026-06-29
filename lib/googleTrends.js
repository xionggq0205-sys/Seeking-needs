// lib/googleTrends.js — 非官方 Google Trends 接入。无第三方依赖。
// 流程: GET trends.google.com 拿 cookie → GET /api/explore 拿 widget token
//      → GET /api/widgetdata/multiline 拿 12 个月时间序列。
//
// 因为是非官方端点 + 风控 + Vercel IP 可能被限速，所有失败都降级为
// { available:false, reason } 而不抛错，调用方按"无趋势数据"处理即可。
//
// 注意：每个响应都以 `)]}',` 防 JSON 劫持开头，需要去掉。

const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

async function fetchWithTimeout(url, opts = {}, ms = 8000) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try {
    return await fetch(url, { ...opts, signal: ctrl.signal });
  } finally {
    clearTimeout(t);
  }
}

function stripPrefix(text) {
  return text.replace(/^[)\]}'\s,]+/, "");
}

async function getNidCookie() {
  try {
    const r = await fetchWithTimeout("https://trends.google.com/?geo=US", {
      headers: { "user-agent": UA, "accept-language": "en-US,en;q=0.9" },
    }, 6000);
    const sc = r.headers.get("set-cookie") || "";
    const nid = sc.match(/NID=[^;]+/)?.[0];
    const aec = sc.match(/AEC=[^;]+/)?.[0];
    return [nid, aec].filter(Boolean).join("; ");
  } catch (e) {
    return "";
  }
}

export async function fetchTrends(keyword, { geo = "", months = 12, timeoutMs = 8000 } = {}) {
  if (!keyword || typeof keyword !== "string") return { available: false, reason: "no keyword" };
  const kw = keyword.trim();
  if (!kw) return { available: false, reason: "empty keyword" };

  try {
    const cookie = await getNidCookie();
    const headers = {
      "user-agent": UA,
      "accept": "application/json, text/plain, */*",
      "accept-language": "en-US,en;q=0.9",
      ...(cookie ? { cookie } : {}),
    };

    const exploreReq = {
      comparisonItem: [{ keyword: kw, geo, time: `today ${months}-m` }],
      category: 0,
      property: "",
    };
    const exploreUrl = `https://trends.google.com/trends/api/explore?hl=en-US&tz=-480&req=${encodeURIComponent(JSON.stringify(exploreReq))}`;
    const er = await fetchWithTimeout(exploreUrl, { headers }, timeoutMs);
    if (!er.ok) return { available: false, reason: `explore ${er.status}` };
    const eText = stripPrefix(await er.text());
    if (!eText || eText[0] !== "{") return { available: false, reason: "explore empty" };
    const eJson = JSON.parse(eText);
    const widget = (eJson.widgets || []).find((w) => w.id === "TIMESERIES");
    if (!widget || !widget.token || !widget.request) return { available: false, reason: "no timeseries widget" };

    const wUrl = `https://trends.google.com/trends/api/widgetdata/multiline?hl=en-US&tz=-480&req=${encodeURIComponent(JSON.stringify(widget.request))}&token=${encodeURIComponent(widget.token)}`;
    const wr = await fetchWithTimeout(wUrl, { headers }, timeoutMs);
    if (!wr.ok) return { available: false, reason: `widget ${wr.status}` };
    const wText = stripPrefix(await wr.text());
    if (!wText || wText[0] !== "{") return { available: false, reason: "widget empty" };
    const wJson = JSON.parse(wText);
    const timeline = wJson?.default?.timelineData || [];
    if (!timeline.length) return { available: false, reason: "empty timeline" };

    const points = timeline
      .map((d) => ({
        ts: Number(d.time) * 1000,
        date: d.formattedTime || d.formattedAxisTime || "",
        value: Number((d.value && d.value[0]) ?? 0),
      }))
      .filter((p) => Number.isFinite(p.value));
    if (!points.length) return { available: false, reason: "no valid points" };

    const values = points.map((p) => p.value);
    const avg = values.reduce((a, b) => a + b, 0) / values.length;
    const latest = values[values.length - 1];
    const third = Math.max(1, Math.floor(values.length / 3));
    const earlyAvg = values.slice(0, third).reduce((a, b) => a + b, 0) / third;
    const lateAvg = values.slice(-third).reduce((a, b) => a + b, 0) / third;
    const growthPct = earlyAvg > 0 ? ((lateAvg - earlyAvg) / earlyAvg) * 100 : 0;
    let trend = "steady";
    if (growthPct >= 20) trend = "up";
    else if (growthPct <= -20) trend = "down";

    return {
      available: true,
      keyword: kw,
      geo: geo || "worldwide",
      months,
      points,
      summary: {
        avg: Math.round(avg * 10) / 10,
        latest,
        earlyAvg: Math.round(earlyAvg * 10) / 10,
        lateAvg: Math.round(lateAvg * 10) / 10,
        growthPct: Math.round(growthPct * 10) / 10,
        trend,
      },
    };
  } catch (e) {
    return { available: false, reason: e.name === "AbortError" ? "timeout" : e.message };
  }
}
