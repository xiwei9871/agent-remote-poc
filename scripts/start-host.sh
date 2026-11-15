#!/bin/sh
# start-host.sh — 启动 POC Host（隔离 DSH_HOME，不弹浏览器）。
# 只管理 POC 专属进程：PID 写入 $POC/dsh-home/host.pid，并记录启动命令行；
# 若已有 POC Host 在运行则退出，不碰任何其他进程。
set -u
POC="${POC:-$HOME/agent-hub-poc}"
export DSH_HOME="$POC/dsh-home"
# Optional POC-only env (CODEX_HOME, provider keys). Local file, never committed.
[ -f "$POC/env.sh" ] && . "$POC/env.sh"
PIDFILE="$DSH_HOME/host.pid"
LOG="$POC/evidence/logs/dsh-web.log"
DSH="$POC/runtime/node_modules/.bin/dsh"
mkdir -p "$(dirname "$LOG")" "$DSH_HOME"

# POC ownership test: the process's working directory must be inside the POC
# sandbox. Command lines can be relative, so cmdline matching is unreliable.
pid_cwd() { lsof -a -p "$1" -d cwd -Fn 2>/dev/null | sed -n 's/^n//p' | tail -1; }

pid_alive_for_poc() {
  _pid="$1"
  [ -n "$_pid" ] && kill -0 "$_pid" 2>/dev/null || return 1
  case "$(pid_cwd "$_pid")" in
    "$POC"/*|"$POC") return 0 ;;
    *) return 1 ;;
  esac
}

if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE" 2>/dev/null || true)
  if pid_alive_for_poc "$OLD"; then
    echo "POC dsh web already running: pid=$OLD"
    exit 0
  fi
  rm -f "$PIDFILE"
fi

cd "$POC/runtime"
nohup "$DSH" web --no-open >>"$LOG" 2>&1 &
NEWPID=$!
echo "$NEWPID" > "$PIDFILE"
ps -p "$NEWPID" -o command= > "$PIDFILE.cmd" 2>/dev/null || true
sleep 8
if pid_alive_for_poc "$NEWPID"; then
  echo "started: pid=$NEWPID log=$LOG"
  grep -E "dsh web:|ds-harness-remote" "$LOG" | tail -12
else
  echo "FAILED to start; last log lines:"
  tail -20 "$LOG"
  exit 1
fi
