#!/usr/bin/env bash
# 一键部署：先推 Worker，再推 GitHub Pages
set -e
cd "$(dirname "$0")"

if ! grep -q 'const PROXY_URL    = "https' index.html; then
  echo "!! index.html 里的 PROXY_URL 还是空的。"
  echo "   先跑 proxy 部署拿到地址，填进去再来。"
  exit 1
fi

echo "== 推送到 GitHub =="
git add -A
git commit -m "${1:-update}" || echo "(没有变更)"
git push -u origin main
echo
echo "完成。GitHub Pages 地址： http://anko.kapp.pp.ua"
