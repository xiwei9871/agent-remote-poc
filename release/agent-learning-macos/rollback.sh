#!/usr/bin/env bash
# rollback.sh — differential rollback: undo ONLY the changes this package
# recorded. Anything the colleague added AFTER install is preserved.
#
# Two change records:
#   config-changes.json   — our 4 learning hooks (merge ops)
#   connect-changes.json  — what `agentmemory connect --with-hooks` added
#
# Identity rules (P0-R2):
#   repoint ops are consumed IN ORDER — two stale hooks that both mapped to
#   the same shim command are restored to their OWN originals, not a shared
#   one. A repoint is only restored when the original script still exists;
#   a dead path removes that entry instead of resurrecting it.
#   add ops match the recorded entry SNAPSHOT (deep-equal), removing the
#   earliest exact match — an identical hook added later by the user is not
#   eaten. connect ops remove only the recorded commands (one occurrence
#   each) and drop mcpServers.agentmemory only when its value is unchanged
#   from what connect wrote.
# A backup of the current config is always written first.
set -euo pipefail

AL_HOME="${AGENT_LEARNING_HOME:-$HOME/.agent-learning}"
DEVIN_CONFIG="${DEVIN_CONFIG:-$HOME/.config/devin/config.json}"
[[ -f "$DEVIN_CONFIG" ]] || { echo "config not found: $DEVIN_CONFIG" >&2; exit 1; }

cp "$DEVIN_CONFIG" "$DEVIN_CONFIG.bak.agentlearning-rollback-$(date +%Y%m%d%H%M%S)"

AL_HOME="$AL_HOME" CONFIG="$DEVIN_CONFIG" node - <<'NODE'
const fs = require("node:fs"), p = require("node:path");
const C = process.env.CONFIG, AL = process.env.AL_HOME;
const cfg = JSON.parse(fs.readFileSync(C, "utf8"));
const load = f => { try { return JSON.parse(fs.readFileSync(f, "utf8")); } catch { return null; } };
const shimRe = /\.agent-learning\/guard\/hook-shim\.mjs/;
const deepEq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let undone = 0;

/* ---- 1. learning-hook ops (ordered repoint pairing + snapshot add) ---- */
const rec = load(p.join(AL, "guard", "config-changes.json"));
const ops = rec?.ops || [];
if (ops.length) {
  const consumed = new Set();   // per-hook identity: each op takes ONE hook
  for (const op of ops) {
    const arr = cfg.hooks?.[op.evt] || [];
    if (op.op === "repoint") {
      const script = ((op.from || "").match(/^node\s+"?([^"\s]+)/) || [])[1];
      const restorable = script && fs.existsSync(script);
      outer: for (const en of arr) {
        for (const h of en.hooks || []) {
          if (!consumed.has(h) && h.command === op.to) {
            consumed.add(h); undone++;
            if (restorable) h.command = op.from; else h.__drop = true;
            break outer;
          }
        }
      }
      arr.forEach(en => { en.hooks = (en.hooks || []).filter(h => !h.__drop); });
    } else if (op.op === "add") {
      for (let i = 0; i < arr.length; i++) {
        if (deepEq(arr[i], op.entry)) { arr.splice(i, 1); undone++; break; }
      }
    }
    cfg.hooks[op.evt] = arr.filter(en => (en.hooks || []).length > 0);
  }
} else {
  // no record — conservative fallback: strip shim-referencing commands only
  for (const [e, arr] of Object.entries(cfg.hooks || {})) {
    cfg.hooks[e] = arr.map(en => { const kept = (en.hooks || []).filter(h => !shimRe.test(h.command || ""));
      undone += (en.hooks || []).length - kept.length;
      return kept.length ? { ...en, hooks: kept } : null; }).filter(Boolean);
  }
}

/* ---- 2. agentmemory connect ops ---- */
const cc = load(p.join(AL, "guard", "connect-changes.json"));
if (cc?.ops) {
  for (const [e, cmds] of Object.entries(cc.ops.hookCommands || {})) {
    const arr = cfg.hooks?.[e] || [];
    for (const cmd of cmds) {
      for (const en of arr) {
        const i = (en.hooks || []).findIndex(h => h.command === cmd);
        if (i >= 0) { en.hooks.splice(i, 1); undone++; break; }
      }
    }
    cfg.hooks[e] = arr.filter(en => (en.hooks || []).length > 0);
  }
  if (cc.ops.mcpAdded && cfg.mcpServers && deepEq(cfg.mcpServers[cc.ops.mcpAdded.key], cc.ops.mcpAdded.value)) {
    delete cfg.mcpServers[cc.ops.mcpAdded.key];
    if (Object.keys(cfg.mcpServers).length === 0) delete cfg.mcpServers;
    undone++;
  }
}

fs.writeFileSync(C, JSON.stringify(cfg, null, 2) + "\n");
console.log(`rollback: undid ${undone} package change(s); post-install additions preserved`);
NODE
echo "Full-file backup of the pre-rollback state kept as config.json.bak.agentlearning-rollback-*"
