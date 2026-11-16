#!/usr/bin/env bash
# install-shim.sh — install hook-shim.mjs at a stable user-level path so that
# user-level Devin hooks survive repo branch switches (Issue #6).
#
# What it does (safe, outside the repo):
#   1. copies hook-shim.mjs -> ~/.agent-learning/guard/hook-shim.mjs
#   2. writes the repo root pointer  -> ~/.agent-learning/guard/repo-root
#   3. prints the config.json diff the OWNER must approve.
# It does NOT modify ~/.config/devin/config.json unless --apply is passed.
# Rollback: repoint the hook commands back to the repo path (see ROLLBACK
# section in docs/learning/STOP_HOOK_EXIT1_RCA.md) and remove the two files.
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"   # .../agent-remote-poc
GUARD_DIR="${AGENT_GUARD_DIR:-$HOME/.agent-learning/guard}"
SHIM_DST="$GUARD_DIR/hook-shim.mjs"
CONFIG="$HOME/.config/devin/config.json"

mkdir -p "$GUARD_DIR"
cp "$(dirname "$0")/hook-shim.mjs" "$SHIM_DST"
printf '%s\n' "$REPO_ROOT" > "$GUARD_DIR/repo-root"
echo "installed: $SHIM_DST"
echo "pointer:   $GUARD_DIR/repo-root -> $REPO_ROOT"

NEW_STOP="node $SHIM_DST scripts/learning/guard/guard.mjs"
NEW_CTX="node $SHIM_DST scripts/learning/session-context.mjs"
echo
echo "Required ~/.config/devin/config.json changes (OWNER approval needed):"
echo "  hooks.PreToolUse[0].hooks[0].command  -> \"$NEW_STOP\""
echo "  hooks.PostToolUse[0].hooks[0].command -> \"$NEW_STOP\""
echo "  hooks.Stop[0].hooks[0].command        -> \"$NEW_STOP\""
echo "  hooks.SessionStart[1].hooks[0].command -> \"$NEW_CTX\""

if [[ "${1:-}" == "--apply" ]]; then
  cp "$CONFIG" "$CONFIG.bak.$(date +%Y%m%d%H%M%S)"
  NEW_STOP="$NEW_STOP" NEW_CTX="$NEW_CTX" CONFIG="$CONFIG" node - <<'NODE'
const fs = require("node:fs");
const cfg = JSON.parse(fs.readFileSync(process.env.CONFIG, "utf8"));
const rep = (arr, i, cmd) => { const h = cfg.hooks?.[arr]?.[i]?.hooks?.[0]; if (h) h.command = cmd; };
rep("PreToolUse", 0, process.env.NEW_STOP);
rep("PostToolUse", 0, process.env.NEW_STOP);
rep("Stop", 0, process.env.NEW_STOP);
rep("SessionStart", 1, process.env.NEW_CTX);
fs.writeFileSync(process.env.CONFIG, JSON.stringify(cfg, null, 2) + "\n");
NODE
  echo "config updated (backup written next to config.json)"
else
  echo
  echo "Not applying. Re-run with --apply after OWNER approves the diff above."
fi
