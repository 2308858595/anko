/**
 * 安科 —— OpenRouter 代理（Cloudflare Worker）
 *
 * 为什么需要它：index.html 要公开托管在 GitHub Pages 上。
 * 静态页面藏不住 API key —— 任何人打开 DevTools 的 Network 面板，
 * 第一个请求的 Authorization 头就是明文。而且一旦 commit 进公开仓库，
 * 它就永远留在 git 历史里，GitHub 的 secret scanning 多半还会直接把它吊销。
 *
 * 所以 key 只存在这里的 secret 中，浏览器和仓库都看不到。
 *
 * 部署：
 *   cd proxy
 *   npx wrangler login
 *   npx wrangler secret put OPENROUTER_KEY     # 粘贴 sk-or-v1-...
 *   npx wrangler deploy
 */

const ALLOWED_MODELS = [                 // 与 OpenRouter 侧的 guardrail 白名单保持一致
  "~google/gemini-flash-latest",
  "google/gemini-3.7-flash",
];
const DEFAULT_MODEL = ALLOWED_MODELS[0];
const MAX_BODY_BYTES = 400_000;
const MAX_OUTPUT_TOKENS = 4000;
const MAX_SESSION_CHARS = 256;   // 上游硬限制：超一个字符就是 400
const MAX_USER_CHARS = 128;

/* 客户端传来的标签是玩家自由输入的文本，会原样落进 OpenRouter 的日志。
   进上游之前先剥掉控制字符再截断——代理不能信任浏览器传的任何长度。 */
const label = (v, max) => typeof v === "string"
  ? (v.replace(/[\u0000-\u001f\u007f]/g, " ").trim().slice(0, max) || undefined)
  : undefined;

const cors = o => ({
  "Access-Control-Allow-Origin": o || "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
});
const bad = (msg, status, o) =>
  new Response(JSON.stringify({ error: { message: msg, code: status } }),
    { status, headers: { "Content-Type": "application/json", ...cors(o) } });

export default {
  async fetch(req, env) {
    // ALLOW_ORIGIN 支持逗号分隔多个来源，方便本地调试与线上共存
    const allowList = (env.ALLOW_ORIGIN || "*").split(",").map(x => x.trim()).filter(Boolean);
    const anyOrigin = allowList.includes("*");
    const origin = req.headers.get("Origin") || "";
    if (!anyOrigin && origin && !allowList.includes(origin))
      return bad("origin not allowed", 403, allowList[0]);
    const co = anyOrigin ? (origin || "*") : (allowList.includes(origin) ? origin : allowList[0]);

    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(co) });
    if (req.method !== "POST")    return bad("POST only", 405, co);
    if (!env.OPENROUTER_KEY)      return bad("代理未配置：还没设 OPENROUTER_KEY secret", 500, co);

    if (env.RATE_LIMITER) {
      const ip = req.headers.get("CF-Connecting-IP") || "anon";
      const { success } = await env.RATE_LIMITER.limit({ key: ip });
      if (!success) return bad("慢一点——这个代理有速率限制。稍等再试，或在设置里填你自己的 OpenRouter key。", 429, co);
    }

    const raw = await req.text();
    if (raw.length > MAX_BODY_BYTES) return bad("请求过大。开一局新的，或调低「完整保留的回合数」。", 413, co);

    let body;
    try { body = JSON.parse(raw); } catch { return bad("invalid JSON", 400, co); }
    if (!Array.isArray(body.messages) || !body.messages.length) return bad("messages required", 400, co);

    // 只放行已知字段；模型不在白名单里就强制换成默认模型
    const safe = {
      model: ALLOWED_MODELS.includes(body.model) ? body.model : DEFAULT_MODEL,
      messages: body.messages,
      stream: body.stream !== false,
      usage: { include: true },
    };
    if (typeof body.temperature === "number")
      safe.temperature = Math.max(0, Math.min(2, body.temperature));
    safe.max_tokens = Math.min(MAX_OUTPUT_TOKENS,
      typeof body.max_tokens === "number" ? body.max_tokens : MAX_OUTPUT_TOKENS);
    // 省钱模式：关掉模型的思考过程（实测省约 2/3）
    if (body.reasoning && typeof body.reasoning === "object") safe.reasoning = body.reasoning;
    // 每局的标题 + 局号，以及浏览器级匿名 id。
    // 这两个字段 OpenRouter 会按请求存下来（generation 记录里的
    // session_id / external_user），是唯一能区分「哪篇安科」的地方——
    // X-Title 是 app 显示名，按局改只会反复覆盖同一个名字。
    const sid = label(body.session_id, MAX_SESSION_CHARS); if (sid) safe.session_id = sid;
    const usr = label(body.user, MAX_USER_CHARS);          if (usr) safe.user = usr;

    /* HTTP-Referer 决定归因到哪个 app（文档原话：primary identifier for
       rankings），它要的是单个 URL。ALLOW_ORIGIN 现在是逗号分隔的列表，
       整串塞进去不是合法 URL，所以单列一个 APP_URL；没配就退回列表第一项。 */
    const appUrl = (env.APP_URL || allowList[0] || "https://localhost/anko").trim();

    const upstream = env.AI_GATEWAY
      ? env.AI_GATEWAY.replace(/\/+$/, "") + "/openrouter/v1/chat/completions"
      : "https://openrouter.ai/api/v1/chat/completions";

    let up;
    try {
      up = await fetch(upstream, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${env.OPENROUTER_KEY}`,
          "Content-Type": "application/json",
          "HTTP-Referer": appUrl,
          "X-Title": "Anko Player",
        },
        body: JSON.stringify(safe),
      });
    } catch (e) {
      return bad("上游连接失败：" + e.message, 502, co);
    }

    if (!up.ok) {
      const t = await up.text();
      return bad("上游返回 " + up.status + "：" +
        t.slice(0, 300).replace(/sk-or-v1-[A-Za-z0-9]+/g, "[redacted]"), up.status, co);
    }

    return new Response(up.body, {
      status: 200,
      headers: {
        "Content-Type": up.headers.get("Content-Type") || "text/event-stream",
        "Cache-Control": "no-cache",
        ...cors(co),
      },
    });
  },
};
