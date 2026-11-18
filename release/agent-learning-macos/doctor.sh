#!/usr/bin/env bash
# doctor.sh — verify an Agent Learning installation actually works.
# Exit 0 = PASS, 1 = FAIL, 2 = PARTIAL (works but with known limitations).
set -uo pipefail

AL_HOME="${AGENT_LEARNING_HOME:-$HOME/.agent-learning}"
GUARD_DIR="$AL_HOME/guard"
DEVIN_CONFIG="${DEVIN_CONFIG:-$HOME/.config/devin/config.json}"
DEVIN_CONFIG_DIR="${DEVIN_CONFIG_DIR:-$(dirname "$DEVIN_CONFIG")}"
MCP_CONFIG="${MCP_CONFIG:-$DEVIN_CONFIG_DIR/mcp_config.json}"
DEVIN_SKILLS_DIR="${DEVIN_SKILLS_DIR:-$DEVIN_CONFIG_DIR/skills}"
SHIM="$GUARD_DIR/hook-shim.mjs"

PASS=0; FAILC=0; PARTIAL=0
ok()   { printf '  PASS  %s\n' "$1"; PASS=$((PASS+1)); }
bad()  { printf '  FAIL  %s\n' "$1"; FAILC=$((FAILC+1)); }
warnp(){ printf '  PART  %s\n' "$1"; PARTIAL=$((PARTIAL+1)); }
say()  { printf '%s\n' "$*"; }

say "== agent-learning doctor =="

# 1. runtime
if command -v node >/dev/null && (( "$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')" >= 18 )); then
  ok "node $(node --version)"
else bad "node >=18 missing"; fi

# 2. bundle integrity
if [[ -f "$GUARD_DIR/manifest.sha256" ]] && (cd "$GUARD_DIR" && shasum -a256 -c manifest.sha256 --quiet) 2>/dev/null; then
  ok "guard bundle sha256 verified ($GUARD_DIR)"
else bad "guard bundle missing or hash mismatch in $GUARD_DIR"; fi

# 3. config wiring
CHK_OUT=$(DEVIN_CONFIG="$DEVIN_CONFIG" SHIM="$SHIM" node - <<'NODE' 2>/dev/null
const fs=require("node:fs");
let cfg; try{cfg=JSON.parse(fs.readFileSync(process.env.DEVIN_CONFIG,"utf8"))}catch{console.log("NO_CONFIG");process.exit(0)}
const re=/scripts\/learning\/(guard\/guard\.mjs|session-context\.mjs)/;
let shimmed=0, stale=0, am=0;
for(const [e,a] of Object.entries(cfg.hooks||{})) (a||[]).forEach(en=>(en.hooks||[]).forEach(h=>{
  const c=h.command||"";
  if(re.test(c)) c.startsWith(`node ${process.env.SHIM}`)?shimmed++:stale++;
  if(/agentmemory/.test(c)) am++;
}));
console.log(`shimmed=${shimmed} stale=${stale} agentmemory_hooks=${am}`);
NODE
)
case "$CHK_OUT" in
  *NO_CONFIG*) bad "Devin config not found: $DEVIN_CONFIG";;
  *shimmed=4*stale=0*) ok "4 learning hooks wired to stable shim";;
  *shimmed=*) warnp "learning hooks: $CHK_OUT (expected shimmed=4 stale=0)";;
  *) warnp "could not parse config hooks ($CHK_OUT)";;
esac
[[ "$CHK_OUT" == *"agentmemory_hooks=0"* ]] && warnp "no agentmemory hooks in config — run 'agentmemory connect devin'" || true

# 4. MCP server entry
if rg -q "agentmemory" "$MCP_CONFIG" 2>/dev/null; then ok "MCP agentmemory server configured"; else warnp "MCP config lacks agentmemory ($MCP_CONFIG)"; fi

# 5. agentmemory daemon
if command -v agentmemory >/dev/null && agentmemory status 2>/dev/null | rg -q "healthy|Connected"; then
  ok "agentmemory daemon healthy ($(agentmemory --version 2>/dev/null || echo '?'))"
else warnp "agentmemory daemon not reachable — long-term memory inactive until started"; fi

# 6. functional hook checks (synthetic, harmless)
pre() { printf '%s' "$1" | node "$SHIM" "$2"; }
if [[ -f "$SHIM" ]]; then
  out=$(pre '{"hook_event_name":"PreToolUse","tool_name":"exec","tool_input":{"command":"pkill -f doctor-e2e"}}' scripts/learning/guard/guard.mjs 2>/dev/null)
  [[ "$out" == *'"decision":"block"'* && "$out" == *E03* ]] && ok "E03 block works (PreToolUse)" || bad "E03 block missing: $out"
  pre '{"hook_event_name":"PreToolUse","tool_name":"exec","tool_input":{"command":"echo ok"}}' scripts/learning/guard/guard.mjs >/dev/null 2>&1 && ok "safe exec allowed" || bad "safe exec rejected"
  pre '{"hook_event_name":"Stop"}' scripts/learning/guard/guard.mjs >/dev/null 2>&1 && ok "Stop hook exit 0" || bad "Stop hook exit nonzero"
  out=$(pre '{"hook_event_name":"SessionStart","cwd":"/tmp"}' scripts/learning/session-context.mjs 2>/dev/null)
  [[ "$out" == *additionalContext* ]] && ok "SessionStart lesson recall returns context" || warnp "SessionStart returned no context (new DB is normal on a fresh machine)"
else bad "shim missing: $SHIM"; fi

# 7. health + residual WARN scan (Issue #8 known issue)
[[ -f "$GUARD_DIR/health.json" ]] && rg -q '"status": *"ok"' "$GUARD_DIR/health.json" 2>/dev/null \
  && ok "shim health.json ok" || warnp "shim health not ok/not present yet"
LOG=$(ls -t "$HOME/Library/Application Support/Devin/logs"/*/window*/exthost/output_logging_*/*devin-cli.log 2>/dev/null | head -1)
if [[ -n "$LOG" ]]; then
  W=$(rg -c "exited with code 1" "$LOG" 2>/dev/null || echo 0)
  [[ "$W" -gt 0 ]] && warnp "Devin log has $W 'hook exit 1' WARNs — known Devin-internal UNATTRIBUTED issue (#8); our hooks are verified healthy above" || ok "no hook WARNs in current Devin log"
fi

# 8. skills installed
N=$(ls -d "$DEVIN_SKILLS_DIR"/*/SKILL.md 2>/dev/null | wc -l | tr -d ' ')
[[ "$N" -ge 7 ]] && ok "$N skills installed" || warnp "only $N skills found in $DEVIN_SKILLS_DIR"

say
if (( FAILC > 0 )); then say "RESULT: FAIL ($FAILC) — fix the FAIL lines, then re-run doctor."; exit 1
elif (( PARTIAL > 0 )); then say "RESULT: PARTIAL — core works; PART lines are limitations, not blockers."; exit 2
else say "RESULT: PASS ($PASS checks)"; exit 0; fi
