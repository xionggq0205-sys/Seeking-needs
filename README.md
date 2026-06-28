# 需求雷达 / DemandRadar（v0.3）

> 找信号，不找灵感。抓取 **Hacker News / Reddit** 上的真实讨论，输出**带证据、可追溯**的需求判断。两种模式：
> - **验证**：主动查一个方向 → 实时抓数据 → 出报告。
> - **发现**：每周定时扫描"狩猎场"，自动给出"本周新痛点 / 正在变热的痛点"（带趋势对比）。

完整产品规划见 [`docs/PRD.md`](docs/PRD.md)。

> ⚠️ 这些代码尚未在联网环境实跑验证过。已尽量做成模块化、零依赖、错误处理完善。**第一次部署或跑扫描若报错，把日志贴出来即可快速修。**

---

## 目录结构

```
index.html                  纯静态前端(CDN React，无需构建)：验证 + 发现两个标签页
api/analyze.js              Vercel Serverless：验证模式接口(扩词→抓数据→过滤噪音→基于证据分析)
scripts/scan.js             发现模式扫描脚本(供 GitHub Actions / 本地运行)
lib/llm.js                  LLM 调用封装(兼容 OpenAI 接口) + 成本护栏 + 重试 + 备用模型
lib/sources.js              数据源适配器：Hacker News(免费) + Reddit(可选 OAuth) + 缓存 + 重试
lib/analyze.js              扩词 + 噪音过滤 + 基于真实语料的痛点分析
lib/trends.js               趋势判定(新 / 变热 / 变冷 / 平稳)
config/huntingground.json   发现模式监控的主题与社区(可自由增删)
.github/workflows/scan.yml  每周定时扫描并把快照提交回仓库
data/                       快照存储(扫描结果以 JSON 提交进仓库)
docs/PRD.md                 完整产品需求文档
```

**两个关键设计**：
- **零额外基础设施**：存储就用本仓库（扫描结果作为 JSON 提交进 `data/`），定时任务用 GitHub Actions。无需数据库、无需额外账号。
- **零 npm 依赖**：全部基于 Node 18+ 内置 `fetch`。前端用 CDN React，无构建步骤。

---

## 数据源

| 源 | 是否需要密钥 | 说明 |
|---|---|---|
| Hacker News | 否 | 用 Algolia HN Search API，开箱即用 |
| Reddit（免费层） | 可选 | 配了 REDDIT_CLIENT_ID / REDDIT_CLIENT_SECRET 才启用；不配则只用 HN |

> 只配 LLM 密钥 + Hacker News，就能完整跑起来。Reddit 是加分项，后补即可。

---

## 你需要准备的密钥

1. LLM API Key（必需）：默认使用 DeepSeek，前往 https://platform.deepseek.com 获取。也支持任何兼容 OpenAI 接口的模型（Kimi / 通义千问等），只需修改 `LLM_BASE_URL` 和 `LLM_MODEL`。
2. Reddit App（可选）：https://www.reddit.com/prefs/apps → Create app → 选 script 类型 → 拿 client id 和 secret。

---

## 第一步：推送到你的 GitHub

```bash
git init
git add .
git commit -m "init: DemandRadar v0.3"
git branch -M main
# 先在 GitHub 建一个空仓库 demand-radar（不勾 README），然后：
git remote add origin https://github.com/<你的用户名>/demand-radar.git
git push -u origin main
```

> 或用 GitHub CLI：gh repo create demand-radar --private --source=. --push

## 第二步：部署「验证模式」（Vercel，约 2 分钟）

1. https://vercel.com → GitHub 登录 → Add New… → Project → 导入 demand-radar。
2. 框架预设选 Other，直接 Deploy。
3. Settings → Environment Variables 添加 `LLM_API_KEY`（以及可选的 `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`）。
4. Deployments → 最新一次 → Redeploy 让变量生效。
5. 得到 https://demand-radar-xxxx.vercel.app —— 打开就能用「验证」标签页。

## 第三步：开启「发现模式」（GitHub Actions 定时扫描）

1. 仓库 Settings → Secrets and variables → Actions → New repository secret，添加：
   - `LLM_API_KEY`（必需）
   - `REDDIT_CLIENT_ID` / `REDDIT_CLIENT_SECRET`（可选）
2. 仓库 Actions 页，若提示启用 workflow 就启用。
3. 第一次手动触发：Actions → weekly-scan → Run workflow。
4. 跑完后，扫描结果会自动提交进 data/，前端「发现」标签页就会显示"本周新痛点 / 正在变热"。
5. 之后每周一自动运行（可在 scan.yml 里改 cron）。

> 默认狩猎场是独立开发者 / SaaS / 创业相关社区。想换范围，改 config/huntingground.json 即可。

## 本地运行（可选）

```bash
# 验证模式接口 + 前端
npm i -g vercel && vercel dev

# 发现模式扫描（需先 export LLM_API_KEY，可选 REDDIT_*）
npm run scan
```

---

## 部署后自检清单

- [ ] 打开网址，「验证」页输入一个方向（如 epub converter），20 秒左右出报告，痛点卡里有真实「原帖 ↗」链接。
- [ ] 报告底部显示「基于 N 条真实抓取的讨论」，N>0（若为 0，多半是检索词太窄或网络问题）。
- [ ] Actions 跑一次 weekly-scan 成功，data/snapshots/ 下出现当天日期的 JSON。
- [ ] 「发现」页显示本周痛点；第二周再跑后，出现 ▲变热 / ●新 等趋势标记。

## 成本与限制

- 验证一次 = 两次 LLM 调用（扩词 + 分析）+ 若干次免费抓取，单次成本通常几美分量级。
- 发现扫描一次 = 一次较大的 LLM 分析 + 多次抓取，按周计成本很低。
- 内置成本护栏：单次运行最多 20 次 LLM 调用、10 万 token（可通过环境变量调整）。
- Hacker News 免费；Reddit 免费层约 100 请求/分钟、非商业用途。
- 这是自用版：未做用户系统 / 计费 / 限流。对外开放前需补这些（见 PRD 商业化章节）。

## 安全

- 所有密钥只放 Vercel 环境变量 / GitHub Actions Secrets，前端与仓库代码里都没有。
- .env、node_modules 已在 .gitignore 忽略。

---

## 路线图（摘自 PRD）

- V1 验证型 + 证据链 ✅（本版）
- V2 发现型 + 趋势 ✅（本版，GitHub Actions + 快照）
- V3 完整 BRD：竞品拆解 / 用户画像 / TAM-SAM-SOM / 锚定定价 / 获客渠道 / GO-NO-GO
- （可选）商业化：商业数据源 + 用户系统 + 计费

*免责：需求分数为辅助判断，不构成保证；证据片段为摘要转述，请点原帖核对。最终决策由你拍板。*
