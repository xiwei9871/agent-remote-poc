#!/usr/bin/env bash
# rollback.sh — differential rollback: undo ONLY the changes this package
# recorded in config-changes.json. Hooks/MCP added AFTER our install are
# preserved (never rolled back wholesale).
#
# Per recorded op:
#   add     → remove that hook command from the event (only if still ours)
#   repoint → restore the original command ONLY where it still equals what
#             we set (user modifications since are kept)
# If no change record exists, fall back to stripping commands that point at
# our shim path. A backup of the current config is always written first.
set -euo pipefail

AL_HOME="${AGENT_LEARNING_HOME:-$HOME/.agent-learning}"
DEVIN_CONFIG="${DEVIN_CONFIG:-$HOME/.config/devin/config.json}"
CHANGES="$AL_HOME/guard/config-changes.json"
[[ -f "$DEVIN_CONFIG" ]] || { echo "config not found: $DEVIN_CONFIG" >&2; exit 1; }

cp "$DEVIN_CONFIG" "$DEVIN_CONFIG.bak.agentlearning-rollback-$(date +%Y%m%d%H%M%S)"

CHANGES="$CHANGES" CONFIG="$DEVIN_CONFIG" node - <<'NODE'
const fs = require("node:fs");
const C = process.env.CONFIG;
const cfg = JSON.parse(fs.readFileSync(C, "utf8"));
let ops = null;
try { ops = JSON.parse(fs.readFileSync(process.env.CHANGES, "utf8")).ops; } catch {}
const re = /\.agent-learning\/guard\/hook-shim\.mjs/;
let undone = 0;
if (ops && ops.length) {
  for (const op of ops) {
    const arr = cfg.hooks?.[op.evt] || [];
    arr.forEach((en, ei) => {
      if (op.op === "repoint") {
        // Restore the original command only if its script still exists on
        // disk; a dead path (deleted worktree/branch) gets the entry removed
        // instead of resurrecting a broken hook.
        const script = (op.from.match(/^node\s+"?([^"\s]+)/) || [])[1];
        const restorable = script && fs.existsSync(script);
        (en.hooks || []).forEach(h => {
          if (h.command === op.to) {
            if (restorable) { h.command = op.from; undone++; }
            else h.__remove = true;
          }
        });
        if (!restorable) {
          const before = (en.hooks || []).length;
          en.hooks = (en.hooks || []).filter(h => !h.__remove);
          undone += before - en.hooks.length;
        }
      }
      if (op.op === "add") {
        const before = (en.hooks || []).length;
        en.hooks = (en.hooks || []).filter(h => h.command !== op.command || !re.test(h.command));
        undone += before - en.hooks.length;
      }
    });
    cfg.hooks[op.evt] = arr.filter(en => (en.hooks || []).length > 0);
  }
} else {
  // fallback: strip any command pointing at our shim (no change record)
  for (const [e, arr] of Object.entries(cfg.hooks || {})) {
    cfg.hooks[e] = arr.map(en => { const kept = (en.hooks || []).filter(h => !re.test(h.command || ""));
      undone += (en.hooks || []).length - kept.length;
      return kept.length ? { ...en, hooks: kept } : null; }).filter(Boolean);
  }
}
fs.writeFileSync(C, JSON.stringify(cfg, null, 2) + "\n");
console.log(`rollback: undid ${undone} package change(s); post-install additions preserved`);
NODE
echo "Full-file backup of the pre-rollback state kept as config.json.bak.agentlearning-rollback-*"
