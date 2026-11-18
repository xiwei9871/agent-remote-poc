#!/usr/bin/env bash
# doctor.sh — verify an Agent Learning installation actually works.
# Uses only POSIX tools + node (no ripgrep dependency — clean Macs may lack it).
# Exit 0 = PASS, 1 = FAIL, 2 = PARTIAL (core works, non-core limitations only).
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

# 1. runtime (core)
if command -v node >/dev/null && node -e 'process.exit(Number(process.versions.node.split(".")[0])>=18?0:1)'; then
  ok "node $(node --version)"
else bad "node >=18 missing — install Node first"; fi

# 2. bundle integrity (core — wrong code must FAIL)
if [[ -f "$GUARD_DIR/manifest.sha256" ]] && (cd "$GUARD_DIR" && shasum -a256 -c manifest.sha256 --quiet) 2>/dev/null; then
  ok "guard bundle sha256 verified"
else bad "guard bundle missing or hash mismatch in $GUARD_DIR — re-run install.sh"; fi

# 3. config wiring (core)
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
  *) bad "learning hooks miswired: $CHK_OUT (expected shimmed=4 stale=0) — re-run install.sh";;
esac
# 3b. agentmemory's own 6 capture hooks — verify per-event, not just a count
AM_OUT=$(DEVIN_CONFIG="$DEVIN_CONFIG" node - <<'NODE' 2>/dev/null
const fs=require("node:fs");
let cfg; try{cfg=JSON.parse(fs.readFileSync(process.env.DEVIN_CONFIG,"utf8"))}catch{console.log("NA");process.exit(0)}
const evs=["SessionStart","UserPromptSubmit","PreToolUse","PostToolUse","Stop","SessionEnd"];
const missing=evs.filter(e=>!((cfg.hooks?.[e]||[]).some(en=>(en.hooks||[]).some(h=>/agentmemory/.test(h.command||"")))));
console.log(missing.length?"missing:"+missing.join(","):"all6");
NODE
)
if [[ "$AM_OUT" == "all6" ]]; then ok "agentmemory 6 capture hooks registered"
elif [[ "$AM_OUT" == "NA" ]]; then warnp "cannot check agentmemory hooks (no config)"
elif ! command -v agentmemory >/dev/null; then warnp "agentmemory hooks absent ($AM_OUT) and CLI missing (--no-deps install?)"
else bad "agentmemory capture hooks missing ($AM_OUT) — run 'agentmemory connect devin --with-hooks'"; fi

# 4. MCP server entry (core for recall) — Devin may keep it in config.json's
#    mcpServers (newer builds migrate it to mcp_config.json); accept either.
if grep -lq "agentmemory" "$MCP_CONFIG" "$DEVIN_CONFIG" 2>/dev/null; then
  ok "MCP agentmemory server configured"
else bad "MCP config lacks agentmemory — recall will not work"; fi

# 5. agentmemory daemon (core for long-term memory)
if ! command -v agentmemory >/dev/null; then
  warnp "agentmemory CLI not installed (--no-deps install?) — memory features inactive"
elif agentmemory status 2>/dev/null | grep -qE "healthy|Connected"; then
  ok "agentmemory daemon healthy ($(agentmemory --version 2>/dev/null || echo '?'))"
else
  bad "agentmemory installed but daemon unreachable — run 'agentmemory' to start it"
fi

# 6. functional hook checks (core — synthetic, harmless)
pre() { printf '%s' "$1" | node "$SHIM" "$2" 2>/dev/null; }
if [[ -f "$SHIM" ]]; then
  out=$(pre '{"hook_event_name":"PreToolUse","tool_name":"exec","tool_input":{"command":"pkill -f doctor-e2e"}}' scripts/learning/guard/guard.mjs)
  case "$out" in *'"decision":"block"'*E03*) ok "E03 block works (PreToolUse)";; *) bad "E03 block missing — guard not enforcing";; esac
  pre '{"hook_event_name":"PreToolUse","tool_name":"exec","tool_input":{"command":"echo ok"}}' scripts/learning/guard/guard.mjs >/dev/null && ok "safe exec allowed" || bad "safe exec rejected"
  pre '{"hook_event_name":"Stop"}' scripts/learning/guard/guard.mjs >/dev/null && ok "Stop hook exit 0" || bad "Stop hook exit nonzero"
  out=$(pre '{"hook_event_name":"SessionStart","cwd":"/tmp"}' scripts/learning/session-context.mjs)
  case "$out" in *additionalContext*) ok "SessionStart recall returns context";; *) warnp "SessionStart returned no context (empty DB is normal on fresh installs)";; esac
else bad "shim missing: $SHIM"; fi

# 7. health + residual WARN scan (non-core: source undetermined, Issue #8)
if [[ -f "$GUARD_DIR/health.json" ]] && grep -q '"status": *"ok"' "$GUARD_DIR/health.json" 2>/dev/null; then
  ok "shim health.json ok"
else warnp "shim health not ok/not present yet"; fi
LOG=$(ls -t "$HOME/Library/Application Support/Devin/logs"/*/window*/exthost/output_logging_*/*devin-cli.log 2>/dev/null | head -1)
if [[ -n "$LOG" ]]; then
  W=$(grep -c "exited with code 1" "$LOG" 2>/dev/null || echo 0)
  if [[ "${W:-0}" -gt 0 ]]; then
    warnp "Devin log has $W 'hook exit 1' WARNs — source UNDETERMINED (Issue #8); our hooks verified healthy above, but WARNs are not proven Devin-internal"
  else ok "no hook WARNs in current Devin log"; fi
fi

# 8. skills installed (non-core)
N=$(ls -d "$DEVIN_SKILLS_DIR"/*/SKILL.md 2>/dev/null | wc -l | tr -d ' ')
[[ "${N:-0}" -ge 7 ]] && ok "$N skills installed" || warnp "only ${N:-0} skills found in $DEVIN_SKILLS_DIR"

say
if (( FAILC > 0 )); then say "RESULT: FAIL ($FAILC) — fix the FAIL lines, then re-run doctor."; exit 1
elif (( PARTIAL > 0 )); then say "RESULT: PARTIAL — core works; PART lines are limitations, not blockers."; exit 2
else say "RESULT: PASS ($PASS checks)"; exit 0; fi
