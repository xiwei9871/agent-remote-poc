#!/bin/sh
# start-host.sh — 启动 POC Host（隔离 DSH_HOME，不弹浏览器）
set -u
POC="${POC:-$HOME/agent-hub-poc}"
export DSH_HOME="$POC/dsh-home"
LOG="$POC/evidence/logs/dsh-web.log"
mkdir -p "$(dirname "$LOG")"
if pgrep -f "dsh web" >/dev/null 2>&1; then
  echo "dsh web already running:"; pgrep -fl "dsh web"; exit 0
fi
cd "$POC/runtime"
nohup ./node_modules/.bin/dsh web --no-open >>"$LOG" 2>&1 &
sleep 8
grep -E "dsh web:|ds-harness-remote" "$LOG" | tail -12
