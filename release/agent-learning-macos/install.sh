#!/usr/bin/env bash
# install.sh — Agent Learning Distribution V1 one-step installer (macOS, Devin).
#
# What it does (with --dry-run it only prints):
#   1. Preflight: macOS, arch, node>=18, npm, Devin config dir.
#   2. npm i -g @agentmemory/agentmemory@<PINNED> (skipped with --no-deps).
#   3. Start the agentmemory daemon if not healthy (`agentmemory`).
#   4. `agentmemory connect devin` — official wiring of its 6 hooks + MCP.
#   5. Install the stable guard bundle to $AGENT_LEARNING_HOME/guard
#      (hash-verified against hooks/manifest.sha256 — never a repo path).
#   6. Merge the 4 learning hooks into the Devin user config: repoint any
#      stale scripts/learning/* command (any checkout/worktree) to the shim,
#      add missing entries, leave every other hook byte-identical.
#      Atomic write + per-entry verification + timestamped backup.
#   7. Install the bundled skills into ~/.config/devin/skills/.
#   8. Print what changed; run doctor.sh for verification afterwards.
#
# Flags: --dry-run  print the exact change list, modify nothing
#        --yes      skip the interactive confirmation
#        --no-deps  skip npm install / daemon / `agentmemory connect`
#                   (offline test, or agentmemory already managed elsewhere)
# Env:   AGENT_LEARNING_HOME (default ~/.agent-learning)
#        DEVIN_CONFIG        (default ~/.config/devin/config.json)
#        DEVIN_CONFIG_DIR    (default dirname of DEVIN_CONFIG)
#        DEVIN_SKILLS_DIR    (default $DEVIN_CONFIG_DIR/skills)
#        AGENTMEMORY_VERSION (default pinned in VERSION file)
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
PKG_VERSION="$(cat "$HERE/VERSION" 2>/dev/null || echo dev)"
AGENTMEMORY_VERSION="${AGENTMEMORY_VERSION:-0.9.32}"
AL_HOME="${AGENT_LEARNING_HOME:-$HOME/.agent-learning}"
GUARD_DIR="$AL_HOME/guard"
DEVIN_CONFIG="${DEVIN_CONFIG:-$HOME/.config/devin/config.json}"
DEVIN_CONFIG_DIR="${DEVIN_CONFIG_DIR:-$(dirname "$DEVIN_CONFIG")}"
DEVIN_SKILLS_DIR="${DEVIN_SKILLS_DIR:-$DEVIN_CONFIG_DIR/skills}"
SHIM="$GUARD_DIR/hook-shim.mjs"

DRY=0; YES=0; NODEPS=0
for a in "$@"; do
  case "$a" in
    --dry-run) DRY=1 ;; --yes|-y) YES=1 ;; --no-deps) NODEPS=1 ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done
say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'FAIL: %s\n' "$*" >&2; exit 1; }
run()  { if [[ $DRY -eq 1 ]]; then say "  [dry] $*"; else "$@"; fi; }

say "== Agent Learning installer v$PKG_VERSION =="
say "target: $GUARD_DIR  config: $DEVIN_CONFIG"

## ---------- 1. preflight ----------
[[ "$(uname -s)" == "Darwin" ]] || die "only macOS is supported (this package was validated on macOS arm64)."
ARCH="$(uname -m)"
[[ "$ARCH" == "arm64" ]] || warn "arch=$ARCH — validated only on arm64; proceeding at your own risk (Intel = NOT_TESTED)."
command -v node >/dev/null || die "node not found on PATH. Install Node >= 18 first (no sudo needed: https://nodejs.org)."
NODE_MAJOR="$(node -e 'process.stdout.write(String(process.versions.node.split(".")[0]))')"
(( NODE_MAJOR >= 18 )) || die "node $(node --version) < 18."
if [[ $NODEPS -eq 0 ]]; then
  command -v npm >/dev/null || die "npm not found on PATH (or re-run with --no-deps)."
fi
[[ -d "$DEVIN_CONFIG_DIR" ]] || warn "$DEVIN_CONFIG_DIR does not exist yet — it will be created; launch Devin once afterwards."
for f in hook-shim.mjs guard.mjs policy.json session-context.mjs manifest.sha256; do
  [[ -f "$HERE/hooks/$f" ]] || die "package incomplete: missing hooks/$f"
done

## ---------- 2. change preview + confirm ----------
say
say "Planned changes on THIS machine:"
say "  - npm global: @agentmemory/agentmemory@$AGENTMEMORY_VERSION $( [[ $NODEPS -eq 1 ]] && echo '(skipped: --no-deps)')"
say "  - daemon:     agentmemory on localhost:3111 (started only if not healthy)"
say "  - config:     merge 4 learning hooks into $DEVIN_CONFIG (backup first; other hooks untouched)"
say "  - files:      $GUARD_DIR/{hook-shim.mjs,bin/*}  +  $DEVIN_SKILLS_DIR/<7 skills>"
say "  - NOT touched: existing MCP/hooks of other tools, project files, memory data."
if [[ $DRY -eq 0 && $YES -eq 0 ]]; then
  printf 'Proceed? [y/N] '; read -r a; [[ "$a" == [yY] ]] || { say "aborted — nothing changed."; exit 0; }
fi

## ---------- 3+4. agentmemory ----------
if [[ $NODEPS -eq 0 ]]; then
  if ! command -v agentmemory >/dev/null || [[ "$(agentmemory --version 2>/dev/null)" != "$AGENTMEMORY_VERSION" ]]; then
    run npm install -g "@agentmemory/agentmemory@$AGENTMEMORY_VERSION"
  else
    say "agentmemory $AGENTMEMORY_VERSION already installed — skipping npm."
  fi
  if [[ $DRY -eq 0 ]]; then
    command -v agentmemory >/dev/null || die "agentmemory install did not produce a binary on PATH."
    [[ "$(agentmemory --version)" == "$AGENTMEMORY_VERSION" ]] || die "agentmemory version mismatch: $(agentmemory --version) != $AGENTMEMORY_VERSION"
  fi
  if agentmemory status >/dev/null 2>&1; then
    say "daemon already healthy — not restarting."
  else
    run agentmemory >/dev/null   # starts the daemonized worker compose
    sleep 2
    [[ $DRY -eq 1 ]] || agentmemory status >/dev/null || warn "daemon not healthy yet — doctor.sh will re-check."
  fi
  run agentmemory connect devin --force  # official wiring of its own hooks+MCP
fi

## ---------- 5. stable guard bundle (hash-verified) ----------
run mkdir -p "$GUARD_DIR/bin"
for pair in "hook-shim.mjs:hook-shim.mjs" "guard.mjs:bin/guard.mjs" "policy.json:bin/policy.json" "session-context.mjs:bin/session-context.mjs"; do
  run cp "$HERE/hooks/${pair%%:*}" "$GUARD_DIR/${pair##*:}"
done
run cp "$HERE/hooks/manifest.sha256" "$GUARD_DIR/manifest.sha256"
if [[ $DRY -eq 0 ]]; then printf '%s\n' "$PKG_VERSION" > "$GUARD_DIR/VERSION"; fi
if [[ $DRY -eq 0 ]]; then
  (cd "$GUARD_DIR" && shasum -a256 -c manifest.sha256 --quiet) \
    || die "installed bundle hash mismatch — refusing to wire hooks to unverified code."
fi

## ---------- 6. merge learning hooks into Devin config ----------
if [[ $DRY -eq 0 ]]; then
  mkdir -p "$DEVIN_CONFIG_DIR"
  [[ -f "$DEVIN_CONFIG" ]] || printf '{}\n' > "$DEVIN_CONFIG"
elif [[ ! -f "$DEVIN_CONFIG" ]]; then
  say "  [dry] would create $DEVIN_CONFIG (currently absent)"
fi
DRY="$DRY" CONFIG="$DEVIN_CONFIG" SHIM="$SHIM" node - <<'NODE'
const fs = require("node:fs");
const CONFIG = process.env.CONFIG, SHIM = process.env.SHIM, DRY = process.env.DRY === "1";
const raw = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, "utf8") : "{}\n";
const cfg = JSON.parse(raw.trim() || "{}");
cfg.hooks = cfg.hooks || {};
const CMD = { "guard/guard.mjs": `node ${SHIM} scripts/learning/guard/guard.mjs`,
              "session-context.mjs": `node ${SHIM} scripts/learning/session-context.mjs` };
const relRe = /scripts\/learning\/(guard\/guard\.mjs|session-context\.mjs)/;
const WANT = [
  { evt: "SessionStart", entry: { hooks: [{ type: "command", command: CMD["session-context.mjs"], timeout: 5 }] }, sig: "session-context.mjs" },
  { evt: "PreToolUse", entry: { matcher: "^(exec|kill_shell|write_to_process|write|edit|apply_patch)$", hooks: [{ type: "command", command: CMD["guard/guard.mjs"], timeout: 5 }] }, sig: "guard/guard.mjs" },
  { evt: "PostToolUse", entry: { matcher: "^(exec)$", hooks: [{ type: "command", command: CMD["guard/guard.mjs"], timeout: 5 }] }, sig: "guard/guard.mjs" },
  { evt: "Stop", entry: { hooks: [{ type: "command", command: CMD["guard/guard.mjs"], timeout: 5 }] }, sig: "guard/guard.mjs" },
];
const changed = [], notes = [];
for (const w of WANT) {
  cfg.hooks[w.evt] = cfg.hooks[w.evt] || [];
  let found = false;
  cfg.hooks[w.evt].forEach((en, i) => (en.hooks || []).forEach((h, j) => {
    const cmd = h.command || "", m = cmd.match(relRe);
    if (!m || m[1] !== w.sig) return;
    found = true;
    if (cmd !== CMD[w.sig]) {
      changed.push(`hooks.${w.evt}[${i}].hooks[${j}].command: repoint stale path -> shim`);
      if (!DRY) h.command = CMD[w.sig];
    } else notes.push(`${w.evt}[${i}]: already correct`);
  }));
  if (!found) {
    changed.push(`hooks.${w.evt}: add entry (${w.sig})`);
    if (!DRY) cfg.hooks[w.evt].push(w.entry);
  }
}
if (!changed.length) { console.log("config: already up to date (idempotent)"); process.exit(0); }
changed.forEach(c => console.log("  change:", c)); notes.forEach(n => console.log("  keep:  ", n));
if (DRY) { console.log("dry-run: config NOT written"); process.exit(0); }
const bak = `${CONFIG}.bak.agentlearning-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
fs.copyFileSync(CONFIG, bak);
const tmp = `${CONFIG}.tmp.${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
// verify: every learning command points at shim; every other command identical
const after = JSON.parse(fs.readFileSync(tmp, "utf8"));
const flat = o => { const out = []; for (const [e, a] of Object.entries(o.hooks || {}))
  (a || []).forEach((en, i) => (en.hooks || []).forEach((h, j) => out.push([`${e}[${i}].hooks[${j}]`, h.command || ""]))); return new Map(out); };
const before = flat(JSON.parse(raw)), now = flat(after);
let ok = true;
for (const [k, v] of now) if (relRe.test(v) && !v.startsWith(`node ${SHIM}`)) ok = false;
for (const [k, v] of before) {
  const nv = now.get(k);
  if (nv !== v && !(relRe.test(v))) { ok = false; console.error("unexpected foreign change:", k); }
}
if (!ok) { fs.rmSync(tmp, { force: true }); console.error("config verification FAILED — not written; backup:", bak); process.exit(1); }
fs.renameSync(tmp, CONFIG);
console.log(`config: ${changed.length} change(s) applied atomically; backup ${bak}`);
NODE

## ---------- 7. skills ----------
for d in "$HERE"/skills/*/; do
  name="$(basename "$d")"
  run mkdir -p "$DEVIN_SKILLS_DIR/$name"
  run cp "$d/SKILL.md" "$DEVIN_SKILLS_DIR/$name/SKILL.md"
done

## ---------- 8. receipt ----------
if [[ $DRY -eq 0 ]]; then
  mkdir -p "$GUARD_DIR"
  cat > "$GUARD_DIR/install-receipt.json" <<EOF
{"package":"agent-learning-macos","version":"$PKG_VERSION","installed_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
 "agentmemory":"${AGENTMEMORY_VERSION}$( [[ $NODEPS -eq 1 ]] && echo ' (not installed: --no-deps)')","guard_dir":"$GUARD_DIR","config":"$DEVIN_CONFIG","skills_dir":"$DEVIN_SKILLS_DIR"}
EOF
fi

say
if [[ $DRY -eq 1 ]]; then
  say "DRY-RUN complete — nothing was written. Re-run without --dry-run to install."
else
  say "Install complete. Now run:  ./doctor.sh   to verify everything works."
fi
