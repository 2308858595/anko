# 部署 Worker（把 key 藏起来）

页面里现在**没有任何 key**。要让访客不用自带 key 就能玩，得先把 Worker 部署起来。
`wrangler login` 会弹浏览器做 OAuth，只能你自己跑。

## 三条命令

```bash
cd proxy
npx wrangler login
npx wrangler secret put OPENROUTER_KEY
npx wrangler deploy
```

第三步会提示你粘贴 key —— 就是你那个已经用 guardrail 限定到 Gemini Flash 的
OpenRouter key（`sk-or-v1-d8ea…` 开头那个，去 OpenRouter 控制台复制）。

> 这个 key **只**进 Cloudflare 的 secret 存储，不会出现在仓库、页面或 git 历史里。
> 本文件也刻意不写全 key —— GitHub 的 secret scanning 会拦截含密钥的推送，而且一旦
> 进了 git 历史就永远擦不干净。

`wrangler deploy` 最后会打印出地址，形如：

```
https://anko-proxy.<你的账号>.workers.dev
```

## 填回页面并重新发布

编辑 `index.html` 第 615 行左右：

```js
const PROXY_URL    = "";
```

改成：

```js
const PROXY_URL    = "https://anko-proxy.你的账号.workers.dev";
```

然后：

```bash
./deploy.sh "接上代理"
```

## 收尾：锁定来源

Pages 跑起来之后，把 `proxy/wrangler.toml` 里的：

```toml
ALLOW_ORIGIN = "*"
```

改成：

```toml
ALLOW_ORIGIN = "https://2308858595.github.io"
```

再 `npx wrangler deploy` 一次，别的网站就盗用不了你的代理了。

---

## 开启 GitHub Pages

仓库 **Settings → Pages** → Source 选 `main` 分支 / `/ (root)`。
一分钟后： https://2308858595.github.io/anko/

## 几道防线

| 防线 | 位置 | 作用 |
|---|---|---|
| key 不进仓库 | Worker secret | 页面和 git 历史里都没有 |
| 模型白名单 | OpenRouter guardrail | 你已配好，只放行 Gemini Flash |
| 模型二次校验 | `worker.js` 的 `ALLOWED_MODELS` | 不在白名单就强制换回默认模型 |
| 消费上限 | OpenRouter 控制台 | 最后一道，建议设月度上限 |
| 来源限制 | `wrangler.toml` 的 `ALLOW_ORIGIN` | 只有你的 Pages 域名能调 |
| 速率限制 | `wrangler.toml` 的 `RATE_LIMITER` | 每 IP 每分钟 40 次 |
| 请求大小 | `worker.js` 的 `MAX_BODY_BYTES` | 400KB |
