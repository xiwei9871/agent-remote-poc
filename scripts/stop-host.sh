#!/bin/sh
# stop-host.sh — 只停止 POC 自己的 dsh web（PID 文件 + 命令行归属校验）。
# 绝不使用 pkill；不会终止其他用户的 DSH/Agent 进程。
set -u
POC="${POC:-$HOME/agent-hub-poc}"
PIDFILE="$POC/dsh-home/host.pid"

if [ ! -f "$PIDFILE" ]; then
  echo "no POC pid file at $PIDFILE; nothing to stop"
  exit 0
fi
PID=$(cat "$PIDFILE" 2>/dev/null || true)
if [ -z "$PID" ]; then
  rm -f "$PIDFILE" "$PIDFILE.cmd"
  echo "empty pid file removed"
  exit 0
fi
CMD=$(ps -p "$PID" -o command= 2>/dev/null || true)
CWD=$(lsof -a -p "$PID" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | tail -1)
case "$CWD" in
  "$POC"/*|"$POC")
    kill "$PID" 2>/dev/null || true
    for _ in 1 2 3 4 5; do
      kill -0 "$PID" 2>/dev/null || break
      sleep 1
    done
    if kill -0 "$PID" 2>/dev/null; then
      kill -9 "$PID" 2>/dev/null || true
    fi
    rm -f "$PIDFILE" "$PIDFILE.cmd"
    echo "stopped POC dsh web pid=$PID"
    ;;
  "")
    rm -f "$PIDFILE" "$PIDFILE.cmd"
    echo "pid $PID already exited; cleaned pid file"
    ;;
  *)
    echo "REFUSE to kill pid=$PID: cwd does not match POC sandbox"
    echo "  cwd: ${CWD:-<unknown>}"
    echo "  cmd: $CMD"
    echo "pid file left in place for inspection: $PIDFILE"
    exit 1
    ;;
esac
