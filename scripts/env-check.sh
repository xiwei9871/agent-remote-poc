#!/bin/sh
# env-check.sh — POC 前置环境核查（只读，不修改系统）
set -u
POC="${POC:-$HOME/agent-hub-poc}"

echo "== system =="
uname -m; sw_vers 2>/dev/null | tail -2; df -h / | tail -1

echo "== node =="
command -v node && node --version
command -v npm && npm --version

echo "== existing agents =="
for c in dsh claude codex devin agent agy pi-acp opencode hermes claude-agent-acp; do
  printf "%-18s" "$c"; command -v "$c" 2>/dev/null || echo "(not found)"
done

echo "== devin bundled cli =="
D=/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin
[ -x "$D" ] && "$D" --version || echo "devin bundled cli not found"

echo "== dsh poc install =="
if [ -x "$POC/runtime/node_modules/.bin/dsh" ]; then
  DSH_HOME="$POC/dsh-home" "$POC/runtime/node_modules/.bin/dsh" --version
else
  echo "not installed at $POC/runtime"
fi

echo "== listeners (dsh should be 127.0.0.1 only) =="
lsof -nP -iTCP -sTCP:LISTEN 2>/dev/null | grep -E ':(3080)' || echo "dsh web not listening"

echo "== hosted service =="
curl -s -o /dev/null -w "dsh.r2049.cn=%{http_code}\n" --max-time 15 https://dsh.r2049.cn/

echo "== remote host log (last 10) =="
tail -10 "$POC/dsh-home/logs/ds-harness-remote/host.log" 2>/dev/null || echo "no host.log"
