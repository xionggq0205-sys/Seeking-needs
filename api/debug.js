// 诊断端点：逐步测试 analyze 的各个导入
let importErrors = {};
let modules = {};

try {
  const llm = await import("../lib/llm.js");
  modules.llm = Object.keys(llm);
} catch (e) {
  importErrors.llm = e.message;
}

try {
  const sources = await import("../lib/sources.js");
  modules.sources = Object.keys(sources);
} catch (e) {
  importErrors.sources = e.message;
}

try {
  const analyze = await import("../lib/analyze.js");
  modules.analyze = Object.keys(analyze);
} catch (e) {
  importErrors.analyze = e.message;
}

export default function handler(req, res) {
  res.status(200).json({
    ok: Object.keys(importErrors).length === 0,
    node: process.version,
    modules,
    importErrors,
  });
}
