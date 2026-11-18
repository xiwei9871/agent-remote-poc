#!/usr/bin/env bash
# install-shim.sh — install the agent-learning guard at a stable user-level
# path so user-level Devin hooks survive repo branch switches (Issue #6,
# PR#7 remediation).
#
# What it installs under ${AGENT_GUARD_DIR:-~/.agent-learning/guard}:
#   hook-shim.mjs            stable entry point
#   bin/guard.mjs            runnable copy of the policy guard
#   bin/policy.json          policy rules next to guard.mjs (HERE/policy.json)
#   bin/session-context.mjs  runnable copy of the SessionStart hook
#   manifest.json            sha256 + version + source paths of the bundle
#   repo-root                pointer used for preferred (live-checkout) lookup
#
# Without --apply it prints the exact config.json changes and stops.
# With --apply it rewrites ONLY hook commands that still point at
# <REPO_ROOT>/scripts/learning/{guard/guard.mjs,session-context.mjs} —
# other hooks, positions and foreign entries are never touched. The config
# is backed up, written atomically, re-validated, and auto-rolled back on
# any verification failure. --rollback restores the newest backup.
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$SCRIPT_DIR/../../.."                  # placeholder; resolved below
# When the installer runs inside a linked worktree (e.g. /private/tmp/al-fix),
# the recorded repo-root must be the MAIN working tree, not the disposable
# worktree — otherwise the shim's live-checkout pointer dies with the worktree.
# git-common-dir of a worktree resolves to <main>/.git; of a main checkout to
# <self>/.git, so dirname() is the main working tree in both cases.
GIT_COMMON="$(git -C "$REPO_ROOT" rev-parse --path-format=absolute --git-common-dir 2>/dev/null || true)"
if [[ -n "$GIT_COMMON" ]]; then
  MAIN_ROOT="$(cd "$(dirname "$GIT_COMMON")" && pwd 2>/dev/null || true)"
  [[ -n "$MAIN_ROOT" ]] && REPO_ROOT="$MAIN_ROOT"
fi
GUARD_DIR="${AGENT_GUARD_DIR:-$HOME/.agent-learning/guard}"
SHIM_DST="$GUARD_DIR/hook-shim.mjs"
CONFIG="${AGENT_DEVIN_CONFIG:-$HOME/.config/devin/config.json}"
ORIGIN_ROOT="$(cd "$SCRIPT_DIR/../../.." && pwd)"  # checkout the installer runs from (may be a worktree)
SRC_GUARD="$SCRIPT_DIR/guard.mjs"
SRC_POLICY="$SCRIPT_DIR/policy.json"
SRC_CTX="$ORIGIN_ROOT/scripts/learning/session-context.mjs"
SRC_SHIM="$SCRIPT_DIR/hook-shim.mjs"

for f in "$SRC_GUARD" "$SRC_POLICY" "$SRC_CTX" "$SRC_SHIM"; do
  [[ -f "$f" ]] || { echo "missing source: $f" >&2; exit 1; }
done

if [[ "${1:-}" == "--rollback" ]]; then
  bak="$(ls -1t "$CONFIG".bak.* 2>/dev/null | head -1 || true)"
  [[ -n "$bak" ]] || { echo "no backup found next to $CONFIG" >&2; exit 1; }
  cp "$bak" "$CONFIG"
  echo "rolled back: $CONFIG <- $bak"
  exit 0
fi

mkdir -p "$GUARD_DIR/bin"
cp "$SRC_SHIM"   "$SHIM_DST"
cp "$SRC_GUARD"  "$GUARD_DIR/bin/guard.mjs"
cp "$SRC_POLICY" "$GUARD_DIR/bin/policy.json"
cp "$SRC_CTX"    "$GUARD_DIR/bin/session-context.mjs"
printf '%s\n' "$REPO_ROOT" > "$GUARD_DIR/repo-root"

# bundle manifest with pinned hashes
GUARD_DIR="$GUARD_DIR" node - <<'NODE'
const fs = require("node:fs"), c = require("node:crypto"), p = require("node:path");
const dir = process.env.GUARD_DIR;
const sha = f => c.createHash("sha256").update(fs.readFileSync(f)).digest("hex");
const files = ["hook-shim.mjs", "bin/guard.mjs", "bin/policy.json", "bin/session-context.mjs"];
const manifest = { version: 2, installed_at: new Date().toISOString(),
  files: Object.fromEntries(files.map(f => [f, { sha256: sha(p.join(dir, f)), bytes: fs.statSync(p.join(dir, f)).size }])) };
fs.writeFileSync(p.join(dir, "manifest.json"), JSON.stringify(manifest, null, 2) + "\n");
NODE

echo "installed: $SHIM_DST"
echo "bundle:    $GUARD_DIR/bin/{guard.mjs,policy.json,session-context.mjs}"
echo "manifest:  $GUARD_DIR/manifest.json"
echo "pointer:   $GUARD_DIR/repo-root -> $REPO_ROOT"

NEW_STOP="node $SHIM_DST scripts/learning/guard/guard.mjs"
NEW_CTX="node $SHIM_DST scripts/learning/session-context.mjs"
echo
echo "Required config.json changes (OWNER approval needed):"
echo "  commands matching scripts/learning/guard/guard.mjs       -> \"$NEW_STOP\""
echo "  commands matching scripts/learning/session-context.mjs -> \"$NEW_CTX\""

# Dry-run by default: compute and print the EXACT per-entry diff against the
# real config without writing. --apply performs the same computation, then
# backs up, writes atomically and re-verifies. A missing config is not an
# error — the bundle still installs and the diff step reports it.
if [[ ! -f "$CONFIG" ]]; then
  echo "note: $CONFIG not found — bundle installed; no hook diff to compute"
  exit 0
fi
MODE="dry"; [[ "${1:-}" == "--apply" ]] && MODE="apply"
NEW_STOP="$NEW_STOP" NEW_CTX="$NEW_CTX" CONFIG="$CONFIG" MODE="$MODE" node - <<'NODE'
const fs = require("node:fs");
const CONFIG = process.env.CONFIG, MODE = process.env.MODE;
const NEW = { "guard/guard.mjs": process.env.NEW_STOP, "session-context.mjs": process.env.NEW_CTX };

const raw = fs.readFileSync(CONFIG, "utf8");
const cfg = JSON.parse(raw);
const changed = [], skipped = [];
const relRe = /scripts\/learning\/(guard\/guard\.mjs|session-context\.mjs)/;

for (const [evt, arr] of Object.entries(cfg.hooks || {})) {
  if (!Array.isArray(arr)) continue;
  arr.forEach((entry, i) => {
    (entry.hooks || []).forEach((h, j) => {
      const cmd = h.command || "";
      const m = cmd.match(relRe);
      if (!m) { skipped.push(`${evt}[${i}].hooks[${j}]: no learning-hook command`); return; }
      // PR#7 P0 fix: the learning-hook signature IS the relative path
      // scripts/learning/{guard/guard.mjs,session-context.mjs}. The absolute
      // prefix is incidental — it may be this checkout, the main working tree,
      // or a DELETED linked worktree (the original bug matched only the
      // installer's own checkout path, so cross-worktree hooks were skipped
      // and --apply returned a false success). Any match is an agent-learning
      // hook and is repointed to the stable shim. Non-matching commands
      // (agentmemory, other tools) are never touched.
      const want = NEW[m[1].includes("guard") ? "guard/guard.mjs" : "session-context.mjs"];
      if (cmd === want) { skipped.push(`${evt}[${i}].hooks[${j}]: already installed`); return; }
      h.command = want;
      changed.push({ path: `hooks.${evt}[${i}].hooks[${j}].command`, from: cmd, to: want });
    });
  });
}
if (!changed.length) {
  console.log(`${MODE}: no matching entries changed (idempotent or nothing to do)`);
  skipped.forEach(s => console.log("  skip:", s));
  process.exit(0);
}
if (MODE === "dry") {
  console.log(`dry-run: ${changed.length} command(s) WOULD change (no write performed):`);
  changed.forEach(c => console.log(`  ${c.path}\n    - ${c.from}\n    + ${c.to}`));
  skipped.forEach(s => console.log("  skip:", s));
  process.exit(0);
}
const bak = `${CONFIG}.bak.${new Date().toISOString().replace(/[-:T]/g, "").slice(0, 14)}`;
fs.copyFileSync(CONFIG, bak);
const tmp = `${CONFIG}.tmp.${process.pid}`;
fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2) + "\n");
// validate: re-parse, confirm every intended change present & others identical
const after = JSON.parse(fs.readFileSync(tmp, "utf8"));
const flat = o => { const out = []; for (const [e, a] of Object.entries(o.hooks || {}))
  (a || []).forEach((en, i) => (en.hooks || []).forEach((h, j) => out.push([`hooks.${e}[${i}].hooks[${j}].command`, h.command]))); return new Map(out); };
const before = flat(JSON.parse(raw)), now = flat(after);
let ok = before.size === now.size;
for (const c of changed) if (now.get(c.path) !== c.to) ok = false;
for (const [k, v] of before) if (!changed.some(c => c.path === k) && now.get(k) !== v) ok = false;
if (!ok) {
  fs.rmSync(tmp, { force: true });
  console.error("apply: verification failed — config NOT modified; backup kept:", bak);
  process.exit(1);
}
fs.renameSync(tmp, CONFIG);
console.log(`apply: ${changed.length} command(s) updated atomically`);
changed.forEach(c => console.log(`  ${c.path}\n    - ${c.from}\n    + ${c.to}`));
console.log("backup:", bak);
skipped.forEach(s => console.log("  skip:", s));
NODE
if [[ "${1:-}" != "--apply" ]]; then
  echo
  echo "Not applying. Re-run with --apply after OWNER approves the diff above."
fi
