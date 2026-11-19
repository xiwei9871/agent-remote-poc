#!/usr/bin/env bash
# install.sh — Agent Learning Distribution V1 one-step installer (Devin).
#
# What it does (with --dry-run it only prints):
#   1. Preflight: OS, arch, node>=18, npm, Devin config dir.
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
set -eEuo pipefail

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
    -h|--help) sed -n '2,27p' "$0"; exit 0 ;;
    *) echo "unknown flag: $a" >&2; exit 2 ;;
  esac
done
say()  { printf '%s\n' "$*"; }
warn() { printf 'WARN: %s\n' "$*" >&2; }
die()  { printf 'FAIL: %s\n' "$*" >&2
         [[ "$(type -t restore_config_on_failure 2>/dev/null)" == "function" ]] && restore_config_on_failure
         exit 1; }
run()  { if [[ $DRY -eq 1 ]]; then say "  [dry] $*"; else "$@" || die "command failed: $*"; fi; }

# sha256 without OS-specific tools: node >=18 is a hard prerequisite anyway,
# so one code path serves macOS (shasum), Linux (sha256sum) and Git Bash.
al_sha256() { node -e 'const c=require("node:crypto"),f=require("node:fs");process.stdout.write(c.createHash("sha256").update(f.readFileSync(process.argv[1])).digest("hex"))' "$1"; }
al_manifest_check() {
  (cd "$1" && node -e 'const c=require("node:crypto"),f=require("node:fs");const bad=[];
    for(const l of f.readFileSync("manifest.sha256","utf8").split("\n")){
      const m=l.match(/^([0-9a-f]{64}) [ *](.+)$/); if(!m)continue;
      if(!f.existsSync(m[2])||c.createHash("sha256").update(f.readFileSync(m[2])).digest("hex")!==m[1])bad.push(m[2]);}
    if(bad.length){console.error("hash mismatch: "+bad.join(","));process.exit(1);}')
}

say "== Agent Learning installer v$PKG_VERSION =="
say "target: $GUARD_DIR  config: $DEVIN_CONFIG"

# Transaction guard (P0-R3/R4): snapshot the config once up-front; if ANY
# later step fails (connect, merge, skills, verification) restore it so a
# failed install never leaves a half-written configuration behind. If the
# config did NOT exist before install (fresh account), failure means
# removing the partial file — restoring "absent", not inventing content.
SNAP=""; HAD_CONFIG=0
if [[ $DRY -eq 0 && -f "$DEVIN_CONFIG" ]]; then
  SNAP="$DEVIN_CONFIG.pre-agentlearning-$(date +%Y%m%d%H%M%S)"
  cp "$DEVIN_CONFIG" "$SNAP"; HAD_CONFIG=1
fi
restore_config_on_failure() {
  if [[ -n "$SNAP" && -f "$SNAP" ]]; then
    cp "$SNAP" "$DEVIN_CONFIG" 2>/dev/null && \
      echo "install failed — config restored to pre-install snapshot ($SNAP)" >&2
  elif [[ $HAD_CONFIG -eq 0 && -f "$DEVIN_CONFIG" ]]; then
    rm -f "$DEVIN_CONFIG" 2>/dev/null && \
      echo "install failed — config did not exist before install; partial file removed" >&2
    rmdir "$DEVIN_CONFIG_DIR" 2>/dev/null || true
  fi
}
trap 'rc=$?; if [[ $rc -ne 0 ]]; then restore_config_on_failure; fi; exit $rc' ERR

## ---------- 1. preflight ----------
# Cross-platform gate: the package is pure bash+node, so there is no hard OS
# refusal — but only macOS arm64 has completed runtime UAT. Everything else
# proceeds with an explicit warning so the result is an informed choice.
OS="$(uname -s)"
case "$OS" in
  Darwin) ;;
  Linux)  warn "platform=Linux — portable code, runtime UAT was completed on macOS arm64 only (Linux = NOT_TESTED). Proceeding." ;;
  MINGW*|MSYS*|CYGWIN*) warn "platform=$OS — Windows NOT_TESTED; Git Bash/WSL may work. Proceeding at your own risk." ;;
  *)      warn "platform=$OS — unrecognised, NOT_TESTED. Proceeding at your own risk." ;;
esac
ARCH="$(uname -m)"
case "$ARCH" in
  arm64|aarch64) ;;
  *) warn "arch=$ARCH — validated only on arm64/aarch64; proceeding at your own risk." ;;
esac
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
  # --with-hooks is REQUIRED: bare `connect` only writes mcpServers and would
  # leave the 6 agentmemory capture hooks out (verified via --dry-run).
  # P0-R2: snapshot config BEFORE connect so rollback can undo exactly what
  # connect added (its 6 hooks + mcpServers) on machines that had none.
  # R4 real-machine finding: `connect` reports "devin (skipped: not-detected)"
  # when ~/.config/devin does not exist — it detects the agent by that dir.
  # Creating it first is what lets a FRESH account actually get wired.
  run mkdir -p "$DEVIN_CONFIG_DIR"
  if [[ $DRY -eq 0 && -f "$DEVIN_CONFIG" ]]; then
    cp "$DEVIN_CONFIG" "$DEVIN_CONFIG.bak.agentmemory-connect-$(date +%Y%m%d%H%M%S)"
  fi
  run agentmemory connect devin --with-hooks --force
  if [[ $DRY -eq 0 && -f "$DEVIN_CONFIG" ]]; then
    AL_HOME="$AL_HOME" CONFIG="$DEVIN_CONFIG" node - <<'NODE'
// Record what `connect` just added: hook commands per event + whether the
// mcpServers.agentmemory key is new (and its value, for exact-restore checks).
const fs = require("node:fs"), p = require("node:path"), os = require("node:os");
const C = process.env.CONFIG;
const bak = fs.readdirSync(p.dirname(C)).filter(f => f.startsWith("config.json.bak.agentmemory-connect-")).sort().pop();
const before = bak ? JSON.parse(fs.readFileSync(p.join(p.dirname(C), bak), "utf8")) : {};
const after = JSON.parse(fs.readFileSync(C, "utf8"));
const addedCmds = {};
const cmdsOf = o => { const m = new Set(); for (const a of Object.values(o.hooks || {})) (a || []).forEach(en => (en.hooks || []).forEach(h => m.add(h.command || ""))); return m; };
const b = cmdsOf(before), a = cmdsOf(after);
for (const [e, arr] of Object.entries(after.hooks || {})) (arr || []).forEach(en => (en.hooks || []).forEach(h => {
  if (h.command && !b.has(h.command)) (addedCmds[e] = addedCmds[e] || []).push(h.command);
}));
const ops = { hookCommands: addedCmds };
if (!before.mcpServers?.agentmemory && after.mcpServers?.agentmemory)
  ops.mcpAdded = { key: "agentmemory", value: after.mcpServers.agentmemory };
const out = p.join(process.env.AGENT_LEARNING_HOME || os.homedir() + "/.agent-learning", "guard", "connect-changes.json");
fs.mkdirSync(p.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ ts: new Date().toISOString(), config: C, backupBefore: bak ? p.join(p.dirname(C), bak) : null, ops }, null, 2) + "\n");
NODE
  fi
fi

## ---------- 5. stable guard bundle (hash-verified) ----------
run mkdir -p "$GUARD_DIR/bin"
for pair in "hook-shim.mjs:hook-shim.mjs" "guard.mjs:bin/guard.mjs" "policy.json:bin/policy.json" "session-context.mjs:bin/session-context.mjs"; do
  run cp "$HERE/hooks/${pair%%:*}" "$GUARD_DIR/${pair##*:}"
done
run cp "$HERE/hooks/manifest.sha256" "$GUARD_DIR/manifest.sha256"
if [[ $DRY -eq 0 ]]; then printf '%s\n' "$PKG_VERSION" > "$GUARD_DIR/VERSION"; fi
if [[ $DRY -eq 0 ]]; then
  al_manifest_check "$GUARD_DIR" \
    || die "installed bundle hash mismatch — refusing to wire hooks to unverified code."
fi

## ---------- 6. merge learning hooks into Devin config ----------
if [[ $DRY -eq 0 ]]; then
  mkdir -p "$DEVIN_CONFIG_DIR"
  [[ -f "$DEVIN_CONFIG" ]] || printf '{}\n' > "$DEVIN_CONFIG"
elif [[ ! -f "$DEVIN_CONFIG" ]]; then
  say "  [dry] would create $DEVIN_CONFIG (currently absent)"
fi
DRY="$DRY" CONFIG="$DEVIN_CONFIG" SHIM="$SHIM" AGENT_LEARNING_HOME="$AL_HOME" node - <<'NODE'
const fs = require("node:fs");
const CONFIG = process.env.CONFIG, SHIM = process.env.SHIM, DRY = process.env.DRY === "1";
const raw = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, "utf8") : "{}\n";
const cfg = JSON.parse(raw.trim() || "{}");
cfg.hooks = cfg.hooks || {};
// Quoted shim path: agentmemory itself writes `node "/abs/path"` commands,
// and quoting is what keeps the command correct when $HOME contains spaces
// (common on Windows profiles and some macOS accounts).
const CMD = { "guard/guard.mjs": `node "${SHIM}" scripts/learning/guard/guard.mjs`,
              "session-context.mjs": `node "${SHIM}" scripts/learning/session-context.mjs` };
const relRe = /scripts\/learning\/(guard\/guard\.mjs|session-context\.mjs)/;
// P0-R3 unique identity: every command WE write carries a per-hook tag
// `# AL-HOOK:<hex>`. Under `sh -c` it is a comment; under exec-array it is
// ignored argv — either way harmless to the shim (which reads argv[2]).
// It makes each installed hook globally unique, so rollback restores the
// exact entry even after the colleague reorders hooks or two stale paths
// mapped to the same shim — the R3 counterexample that position-pairing
// could not solve.
const tag = () => ` # AL-HOOK:${require("node:crypto").randomBytes(4).toString("hex")}`;
// Legacy installs used the unquoted `node ${SHIM}` form — still recognise it
// as ours so an upgrade does not repoint-and-retag already-correct hooks.
const isOurs = (c, sig) => {
  const unq = CMD[sig].replaceAll('"', "");
  return c === CMD[sig] || c.startsWith(CMD[sig] + " # AL-HOOK:") ||
         c === unq || c.startsWith(unq + " # AL-HOOK:");
};
const WANT = [
  { evt: "SessionStart", sig: "session-context.mjs", matcher: null },
  { evt: "PreToolUse",  sig: "guard/guard.mjs", matcher: "^(exec|kill_shell|write_to_process|write|edit|apply_patch)$" },
  { evt: "PostToolUse", sig: "guard/guard.mjs", matcher: "^(exec)$" },
  { evt: "Stop",        sig: "guard/guard.mjs", matcher: null },
];
const changed = [], notes = [], ops = [];   // ops = machine-readable diff for rollback
for (const w of WANT) {
  cfg.hooks[w.evt] = cfg.hooks[w.evt] || [];
  let found = false;
  cfg.hooks[w.evt].forEach((en, i) => (en.hooks || []).forEach((h, j) => {
    const cmd = h.command || "", m = cmd.match(relRe);
    if (!m || m[1] !== w.sig) return;
    found = true;
    if (!isOurs(cmd, w.sig)) {
      const to = CMD[w.sig] + tag();
      changed.push(`hooks.${w.evt}[${i}].hooks[${j}].command: repoint stale path -> shim`);
      ops.push({ op: "repoint", evt: w.evt, from: cmd, to });
      if (!DRY) h.command = to;
    } else notes.push(`${w.evt}[${i}]: already correct`);
  }));
  if (!found) {
    const to = CMD[w.sig] + tag();
    const entry = w.matcher
      ? { matcher: w.matcher, hooks: [{ type: "command", command: to, timeout: 5 }] }
      : { hooks: [{ type: "command", command: to, timeout: 5 }] };
    changed.push(`hooks.${w.evt}: add entry (${w.sig})`);
    ops.push({ op: "add", evt: w.evt, entry });   // snapshot (tagged) for exact removal
    if (!DRY) cfg.hooks[w.evt].push(entry);
  }
}
if (!changed.length) { console.log("config: already up to date (idempotent)"); process.exit(0); }
changed.forEach(c => console.log("  change:", c)); notes.forEach(n => console.log("  keep:  ", n));
if (DRY) { console.log("dry-run: config NOT written"); process.exit(0); }
const bak = `${CONFIG}.bak.agentlearning-${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
fs.copyFileSync(CONFIG, bak);
const tmp = `${CONFIG}.tmp.${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
// P0-B: persist the exact per-entry diff so rollback can restore only what
// we changed instead of rolling back the whole file (which would eat hooks
// the colleague added after install).
const receiptPath = `${process.env.AGENT_LEARNING_HOME || require("node:os").homedir() + "/.agent-learning"}/guard/config-changes.json`;
try { fs.mkdirSync(require("node:path").dirname(receiptPath), { recursive: true });
  // accumulate ops across installs — rollback must be able to undo EVERY
  // package change, not just the most recent run
  let all = [];
  try { all = JSON.parse(fs.readFileSync(receiptPath, "utf8")).ops || []; } catch {}
  fs.writeFileSync(receiptPath, JSON.stringify({ ts: new Date().toISOString(), config: CONFIG, backup: bak, ops: all.concat(ops) }, null, 2) + "\n"); } catch {}
// verify: every learning command points at shim; every other command identical
const after = JSON.parse(fs.readFileSync(tmp, "utf8"));
const flat = o => { const out = []; for (const [e, a] of Object.entries(o.hooks || {}))
  (a || []).forEach((en, i) => (en.hooks || []).forEach((h, j) => out.push([`${e}[${i}].hooks[${j}]`, h.command || ""]))); return new Map(out); };
const before = flat(JSON.parse(raw)), now = flat(after);
let ok = true;
for (const [k, v] of now) if (relRe.test(v) && !v.startsWith(`node "${SHIM}"`) && !v.startsWith(`node ${SHIM}`)) ok = false;
for (const [k, v] of before) {
  const nv = now.get(k);
  if (nv !== v && !(relRe.test(v))) { ok = false; console.error("unexpected foreign change:", k); }
}
if (!ok) { fs.rmSync(tmp, { force: true }); console.error("config verification FAILED — not written; backup:", bak); process.exit(1); }
fs.renameSync(tmp, CONFIG);
console.log(`config: ${changed.length} change(s) applied atomically; backup ${bak}`);
NODE

## ---------- 7. skills (ownership-protected) ----------
# P0-A: never overwrite or later delete a skill the colleague already had.
# Every dir we create gets an .agent-learning-owned marker recording the
# installed SKILL.md sha256; pre-existing dirs with different content are
# backed up aside instead of overwritten; uninstall removes ONLY marked,
# byte-identical installs (user-modified ones are moved aside, not deleted).
for d in "$HERE"/skills/*/; do
  name="$(basename "$d")"; dst="$DEVIN_SKILLS_DIR/$name"
  if [[ -d "$dst" && -f "$dst/.agent-learning-owned" ]]; then
    # P0-R2: ours but user-modified since install → preserve their edit, then
    # refresh. Never silently overwrite a colleague's modification.
    recorded="$(cat "$dst/.agent-learning-owned")"
    current="$(al_sha256 "$dst/SKILL.md" 2>/dev/null)"
    if [[ "$current" != "$recorded" ]]; then
      aside="$dst.user-modified-$(date +%Y%m%d%H%M%S)"
      warn "skill '$name' was modified after install — preserving it as $aside"
      run mv "$dst" "$aside"
    fi
  elif [[ -d "$dst" ]]; then
    if ! diff -q "$d/SKILL.md" "$dst/SKILL.md" >/dev/null 2>&1; then
      bak="$dst.pre-agent-learning-$(date +%Y%m%d%H%M%S)"
      warn "skill '$name' already exists with different content — backing it up to $bak"
      run cp -R "$dst" "$bak"
    else
      # identical foreign skill: adopt nothing, claim nothing — leave it alone
      say "skill '$name' already present with identical content — left as-is (not ours)"
      continue
    fi
  fi
  run mkdir -p "$dst"
  run cp "$d/SKILL.md" "$dst/SKILL.md"
  if [[ $DRY -eq 0 ]]; then
    al_sha256 "$dst/SKILL.md" > "$dst/.agent-learning-owned"
  fi
done

## ---------- 8. receipt ----------
if [[ $DRY -eq 0 ]]; then
  mkdir -p "$GUARD_DIR"
  cat > "$GUARD_DIR/install-receipt.json" <<EOF
{"package":"agent-learning","version":"$PKG_VERSION","installed_at":"$(date -u +%Y-%m-%dT%H:%M:%SZ)",
 "agentmemory":"${AGENTMEMORY_VERSION}$( [[ $NODEPS -eq 1 ]] && echo ' (not installed: --no-deps)')","guard_dir":"$GUARD_DIR","config":"$DEVIN_CONFIG","skills_dir":"$DEVIN_SKILLS_DIR"}
EOF
fi

say
if [[ $DRY -eq 1 ]]; then
  say "DRY-RUN complete — nothing was written. Re-run without --dry-run to install."
else
  say "Install complete. Now run:  ./doctor.sh   to verify everything works."
fi
