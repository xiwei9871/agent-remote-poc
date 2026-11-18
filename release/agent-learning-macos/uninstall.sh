#!/usr/bin/env bash
# uninstall.sh — remove this package's own parts. Keeps personal memory data
# by default (AgentMemory DB is NOT touched); pass --remove-agentmemory to
# also run `agentmemory remove --keep-data`, or --purge-data for full wipe.
set -euo pipefail

AL_HOME="${AGENT_LEARNING_HOME:-$HOME/.agent-learning}"
GUARD_DIR="$AL_HOME/guard"
DEVIN_CONFIG="${DEVIN_CONFIG:-$HOME/.config/devin/config.json}"
DEVIN_CONFIG_DIR="${DEVIN_CONFIG_DIR:-$(dirname "$DEVIN_CONFIG")}"
DEVIN_SKILLS_DIR="${DEVIN_SKILLS_DIR:-$DEVIN_CONFIG_DIR/skills}"
SKILLS="memory-recall error-triage self-repair lesson-distiller lesson-validator evidence-verifier learning-health"

REMOVE_AM=0; PURGE=0
for a in "$@"; do case "$a" in
  --remove-agentmemory) REMOVE_AM=1 ;; --purge-data) PURGE=1 ;; -h|--help) sed -n '2,5p' "$0"; exit 0 ;;
  *) echo "unknown flag: $a" >&2; exit 2 ;; esac; done

# 1. strip our hook entries from the Devin config (foreign entries untouched)
if [[ -f "$DEVIN_CONFIG" ]]; then
  cp "$DEVIN_CONFIG" "$DEVIN_CONFIG.bak.agentlearning-uninstall-$(date +%Y%m%d%H%M%S)"
  CONFIG="$DEVIN_CONFIG" node - <<'NODE'
const fs=require("node:fs");const C=process.env.CONFIG;
const cfg=JSON.parse(fs.readFileSync(C,"utf8"));
const re=/scripts\/learning\/(guard\/guard\.mjs|session-context\.mjs)|\.agent-learning\/guard\/hook-shim\.mjs/;
let removed=0;
for(const [e,arr] of Object.entries(cfg.hooks||{})){
  cfg.hooks[e]=arr.map(en=>{const kept=(en.hooks||[]).filter(h=>!re.test(h.command||""));
    removed+=(en.hooks||[]).length-kept.length;
    return kept.length?{...en,hooks:kept}:null;}).filter(Boolean);
}
fs.writeFileSync(C,JSON.stringify(cfg,null,2)+"\n");
console.log(`config: removed ${removed} learning hook entr${removed===1?"y":"ies"} (others untouched)`);
NODE
else
  echo "config not found — skipping hook removal"
fi

# 2. remove our skills and stable dir
for s in $SKILLS; do rm -rf "$DEVIN_SKILLS_DIR/$s"; done
rm -rf "$GUARD_DIR"
echo "removed: skills + $GUARD_DIR"

# 3. agentmemory (opt-in)
if [[ $REMOVE_AM -eq 1 ]]; then
  if command -v agentmemory >/dev/null; then agentmemory remove --keep-data; else echo "agentmemory binary not found"; fi
else
  echo "agentmemory left installed (pass --remove-agentmemory to uninstall it too; --keep-data is used so memories survive)"
fi
if [[ $PURGE -eq 1 ]]; then rm -rf "$HOME/.agentmemory" && echo "purged ~/.agentmemory data"; else echo "memory data kept (~/.agentmemory). Use --purge-data to delete."; fi

echo "uninstall complete."
