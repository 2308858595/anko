# Worker（已部署）

代理已经在跑：`https://anko-proxy.account-85d.workers.dev`
`index.html` 里的 `PROXY_URL` 已填好，页面内**没有任何 key**。

| 项目 | 值 |
|---|---|
| Worker | `anko-proxy` |
| 站点 | http://anko.kapp.pp.ua |
| 模型 | `~google/gemini-flash-latest`（当前解析到 gemini-3.7-flash） |
| 允许来源 | anko.kapp.pp.ua（http/https）、2308858595.github.io、localhost:8777 |

## 要改东西时

```bash
cd proxy
export CLOUDFLARE_API_TOKEN="$(cat ~/.cf_anko_token)"
export CLOUDFLARE_ACCOUNT_ID=685d37ed8a794aa945fcde628a174191
npx wrangler deploy
```

换 OpenRouter key：

```bash
npx wrangler secret put OPENROUTER_KEY
```

## 防线

| 防线 | 位置 | 状态 |
|---|---|---|
| key 不进仓库/页面 | Worker secret | ✅ 全历史扫过，干净 |
| 模型白名单 | OpenRouter guardrail | ✅ 你已配好，只放行 Gemini Flash |
| 模型二次校验 | `worker.js` 的 `ALLOWED_MODELS` | ✅ 实测传 claude 会被换回 gemini |
| 来源限制 | `ALLOW_ORIGIN` | ✅ 实测 evil.example.com → 403 |
| 速率限制 | `RATE_LIMITER` | ✅ 每 IP 每分钟 40 次 |
| 请求大小 | `MAX_BODY_BYTES` | ✅ 400KB |
| 消费上限 | OpenRouter 控制台 | ⚠️ 建议你去设一个月度上限 |
