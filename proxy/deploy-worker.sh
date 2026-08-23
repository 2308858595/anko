#!/usr/bin/env bash
# 非交互部署 Worker。token 从 ~/.cf_anko_token 读，不出现在命令行或日志里。
set -euo pipefail
cd "$(dirname "$0")"
export PATH="$HOME/Claude/tools/node/bin:$PATH"

TOKF="$HOME/.cf_anko_token"
[ -f "$TOKF" ] || { echo "!! 找不到 $TOKF"; exit 1; }
export CLOUDFLARE_API_TOKEN="$(tr -d '[:space:]' < "$TOKF")"

# 账号 ID：优先用现成的，否则用 token 自己查
if [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "使用已给定的账号 ID"
else
  CLOUDFLARE_ACCOUNT_ID="$(curl -s -H "Authorization: Bearer $CLOUDFLARE_API_TOKEN" \
    https://api.cloudflare.com/client/v4/accounts \
    | python3 -c 'import json,sys; d=json.load(sys.stdin); print(d["result"][0]["id"] if d.get("success") and d.get("result") else "")')"
  [ -n "$CLOUDFLARE_ACCOUNT_ID" ] || { echo "!! 查不到账号 ID —— token 可能缺 Account Settings:Read"; exit 1; }
  export CLOUDFLARE_ACCOUNT_ID
  echo "自动检测到账号 ID: ${CLOUDFLARE_ACCOUNT_ID:0:8}…"
fi

# OpenRouter key 从环境变量传入，管道喂给 wrangler，不落盘
[ -n "${OPENROUTER_KEY:-}" ] || { echo "!! 需要设置 OPENROUTER_KEY 环境变量"; exit 1; }
echo "== 写入 secret =="
printf '%s' "$OPENROUTER_KEY" | npx --yes wrangler secret put OPENROUTER_KEY

echo "== 部署 =="
npx --yes wrangler deploy
