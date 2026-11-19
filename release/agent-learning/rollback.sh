#!/usr/bin/env bash
# rollback.sh — differential rollback: undo ONLY the changes this package
# recorded. Anything the colleague added AFTER install is preserved.
#
# Two change records:
#   config-changes.json   — our 4 learning hooks (merge ops)
#   connect-changes.json  — what `agentmemory connect --with-hooks` added
#
# Identity rules (P0-R2):
#   repoint ops restore by UNIQUE IDENTITY: commands written by this
#   package carry a `# AL-HOOK:<hex>` tag, so op.to matches exactly one
#   hook no matter how the colleague reordered or duplicated entries —
#   two stale paths that mapped to the same shim restore to their OWN
#   originals even if the entries were otherwise identical. Older receipts
#   without a tag fall back to `mask` (entry fingerprint) and then to
#   first-unconsumed order. A repoint is only restored when the original
#   script still exists; a dead path removes that entry instead of
#   resurrecting it.
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
  const maskOf = (en, j) => JSON.stringify({
    ...en,
    hooks: (en.hooks || []).map((x, k) => k === j ? { ...x, command: "@AL-MASK@" } : x),
  });
  for (const op of ops) {
    const arr = cfg.hooks?.[op.evt] || [];
    if (op.op === "repoint") {
      // quoted paths may contain spaces — try quoted form first, then bare
      const m = (op.from || "").match(/^node\s+"([^"]+)"/) || (op.from || "").match(/^node\s+(\S+)/);
      const script = m && m[1];
      const restorable = script && fs.existsSync(script);
      if (/# AL-HOOK:[0-9a-f]+$/.test(op.to || "")) {
        // unique-tag identity: op.to matches exactly one hook globally
        let hit = null;
        outer: for (const en of arr) {
          for (const h of en.hooks || []) {
            if (h.command === op.to) { hit = h; break outer; }
          }
        }
        if (hit) {
          undone++;
          if (restorable) hit.command = op.from; else hit.__drop = true;
        } else console.log(`rollback: ${op.evt} — tagged hook not found (removed/edited?), left as-is`);
      } else if (op.mask) {
        // legacy fingerprint fallback (pre-tag receipts)
        let hit = null;
        outer: for (const en of arr) {
          for (let j = 0; j < (en.hooks || []).length; j++) {
            const h = en.hooks[j];
            if (!consumed.has(h) && h.command === op.to && maskOf(en, j) === op.mask) { hit = h; break outer; }
          }
        }
        if (hit) {
          consumed.add(hit); undone++;
          if (restorable) hit.command = op.from; else hit.__drop = true;
        } else console.log(`rollback: ${op.evt} — recorded entry not found (edited since install?), left as-is`);
      } else {
        // legacy record without mask: first-unconsumed order (documented)
        outer: for (const en of arr) {
          for (const h of en.hooks || []) {
            if (!consumed.has(h) && h.command === op.to) {
              consumed.add(h); undone++;
              if (restorable) h.command = op.from; else h.__drop = true;
              break outer;
            }
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
