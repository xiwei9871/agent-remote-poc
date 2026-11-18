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

# 2. remove ONLY skills this package installed (ownership marker + hash match).
#    User-modified installs are moved aside, never hard-deleted; dirs without
#    our marker are left untouched (they belonged to the colleague already).
for s in $SKILLS; do
  dst="$DEVIN_SKILLS_DIR/$s"
  [[ -d "$dst" ]] || continue
  if [[ ! -f "$dst/.agent-learning-owned" ]]; then
    echo "keep: $s (no ownership marker — not installed by this package)"
    continue
  fi
  recorded="$(cat "$dst/.agent-learning-owned")"
  current="$(shasum -a256 "$dst/SKILL.md" 2>/dev/null | awk '{print $1}')"
  if [[ "$current" == "$recorded" ]]; then
    rm -rf "$dst"; echo "removed: skill $s"
  else
    mv "$dst" "$dst.removed-agent-learning-$(date +%Y%m%d%H%M%S)"
    echo "moved aside: skill $s (modified since install — preserved, not deleted)"
  fi
done
rm -rf "$GUARD_DIR"
rmdir "$AL_HOME" 2>/dev/null || true   # remove parent only if left empty
echo "removed: $GUARD_DIR"

# 3. agentmemory (opt-in)
if [[ $REMOVE_AM -eq 1 ]]; then
  if command -v agentmemory >/dev/null; then agentmemory remove --keep-data; else echo "agentmemory binary not found"; fi
else
  echo "agentmemory left installed (pass --remove-agentmemory to uninstall it too; --keep-data is used so memories survive)"
fi
if [[ $PURGE -eq 1 ]]; then
  # P0-C: memory DB deletion requires explicit typed confirmation.
  if [[ "${CONFIRM_PURGE:-}" == "DELETE-DATA" ]]; then
    rm -rf "$HOME/.agentmemory" && echo "purged ~/.agentmemory data"
  elif [[ -t 0 ]]; then
    printf 'This permanently deletes ALL personal memories in %s. Type DELETE-DATA to confirm: ' "$HOME/.agentmemory"
    read -r c; [[ "$c" == "DELETE-DATA" ]] && rm -rf "$HOME/.agentmemory" && echo "purged" || echo "purge cancelled — data kept"
  else
    echo "--purge-data needs confirmation: re-run with CONFIRM_PURGE=DELETE-DATA (non-interactive) or confirm at the prompt"
  fi
else
  echo "memory data kept (~/.agentmemory). Use --purge-data to delete (requires typed confirmation)."
fi

echo "uninstall complete."
