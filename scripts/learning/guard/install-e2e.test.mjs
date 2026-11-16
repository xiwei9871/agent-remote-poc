// E2E isolated-HOME tests for install-shim.sh — PR#7 remediation.
// Run: node --test scripts/learning/guard/install-e2e.test.mjs
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GDIR = dirname(fileURLToPath(import.meta.url));
const INSTALLER = join(GDIR, "install-shim.sh");
const ROOT = mkdtempSync(join(tmpdir(), "e2e-home-"));
const HOME_DIR = join(ROOT, "home");
const GUARD_DIR = join(HOME_DIR, ".agent-learning", "guard");
const CONFIG = join(HOME_DIR, ".config", "devin", "config.json");
const EMPTY_REPO = join(ROOT, "empty-checkout");   // branch WITHOUT learning/
mkdirSync(HOME_DIR, { recursive: true });
mkdirSync(EMPTY_REPO, { recursive: true });
process.on("exit", () => rmSync(ROOT, { recursive: true, force: true }));

const env = () => ({ ...process.env, HOME: HOME_DIR, AGENT_GUARD_DIR: GUARD_DIR, AGENT_DEVIN_CONFIG: CONFIG, AGENT_GUARD_HOME: "" });

const bash = (args) => spawnSync("bash", args, { env: env(), encoding: "utf8", timeout: 30000 });
const shim = (rel, stdin, extraEnv = {}) => spawnSync("node", [join(GUARD_DIR, "hook-shim.mjs"), rel], {
  input: stdin, env: { ...env(), ...extraEnv }, encoding: "utf8", timeout: 15000 });

const E03_PRE = JSON.stringify({
  session_id: "e2e", hook_event_name: "PreToolUse", tool_name: "exec",
  tool_input: { command: "pkill -f python" } });
const auditEntries = () => {
  try { return readFileSync(join(GUARD_DIR, "audit.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse); }
  catch { return []; }
};

test("install: full runnable bundle lands in user dir, manifest pinned", () => {
  const r = bash([INSTALLER]);
  if (r.status !== 0) throw new Error(`installer failed: ${r.stderr}`);
  for (const f of ["hook-shim.mjs", "bin/guard.mjs", "bin/policy.json", "bin/session-context.mjs", "manifest.json", "repo-root"])
    if (!existsSync(join(GUARD_DIR, f))) throw new Error(`missing installed file: ${f}`);
  const man = JSON.parse(readFileSync(join(GUARD_DIR, "manifest.json"), "utf8"));
  if (Object.keys(man.files).length !== 4) throw new Error("manifest incomplete");
  const root = readFileSync(join(GUARD_DIR, "repo-root"), "utf8").trim();
  const expected = dirname(dirname(dirname(GDIR))); // <repo>/scripts/learning/guard -> <repo>
  if (root !== expected || root.endsWith("/scripts"))
    throw new Error(`repo-root wrong: ${root} (expected ${expected})`);
});

test("branch without learning/: installed bin guard still blocks E03", () => {
  // repo-root points at the REAL repo, but simulate a foreign branch by
  // pointing AGENT_GUARD_HOME+repo-root at an empty checkout -> bin fallback.
  writeFileSync(join(GUARD_DIR, "repo-root"), EMPTY_REPO + "\n");
  const r = shim("scripts/learning/guard/guard.mjs", E03_PRE);
  const v = JSON.parse(r.stdout);
  if (v.decision !== "block" || !/E03/.test(v.reason))
    throw new Error(`E03 not blocked via installed bin: ${r.stdout}`);
});

test("guard truly absent -> PreToolUse fails CLOSED (not silent)", () => {
  rmSync(join(GUARD_DIR, "bin"), { recursive: true, force: true });
  const r = shim("scripts/learning/guard/guard.mjs", E03_PRE);
  const v = JSON.parse(r.stdout);
  if (v.decision !== "block" || !/guard-unavailable/.test(v.reason))
    throw new Error(`expected fail-closed block, got ${r.stdout}`);
  const h = JSON.parse(readFileSync(join(GUARD_DIR, "health.json"), "utf8"));
  if (h.status !== "degraded") throw new Error("failure not observable in health.json");
});

test("--apply: only repo-learning commands rewritten; idempotent; rollback", () => {
  // reinstall bundle first (previous test deleted bin/)
  if (bash([INSTALLER]).status !== 0) throw new Error("reinstall failed");
  const repoRoot = readFileSync(join(GUARD_DIR, "repo-root"), "utf8").trim();
  mkdirSync(dirname(CONFIG), { recursive: true });
  const cfg = {
    hooks: {
      PreToolUse: [
        { matcher: "exec", hooks: [{ type: "command", command: `node ${repoRoot}/scripts/learning/guard/guard.mjs` }] },
        { matcher: "web", hooks: [{ type: "command", command: "node /other/hook.mjs" }] }],
      Stop: [
        { hooks: [{ type: "command", command: `node ${repoRoot}/scripts/learning/guard/guard.mjs` },
                  { type: "command", command: "node /keep/me.mjs" }] }],
      SessionStart: [
        { hooks: [{ type: "command", command: "node /unrelated.mjs" }] },
        { hooks: [{ type: "command", command: `node ${repoRoot}/scripts/learning/session-context.mjs` }] }] } };
  writeFileSync(CONFIG, JSON.stringify(cfg, null, 2));

  const r1 = bash([INSTALLER, "--apply"]);
  if (r1.status !== 0) throw new Error(`--apply failed: ${r1.stderr}`);
  const SHIM = join(GUARD_DIR, "hook-shim.mjs");
  const after = JSON.parse(readFileSync(CONFIG, "utf8"));
  const want = `node ${SHIM} scripts/learning/guard/guard.mjs`;
  if (after.hooks.PreToolUse[0].hooks[0].command !== want) throw new Error("PreToolUse not repointed");
  if (after.hooks.Stop[0].hooks[0].command !== want) throw new Error("Stop not repointed");
  if (!after.hooks.SessionStart[1].hooks[0].command.includes("session-context.mjs")) throw new Error("SessionStart not repointed");
  // untouched entries
  if (after.hooks.PreToolUse[1].hooks[0].command !== "node /other/hook.mjs") throw new Error("foreign hook modified!");
  if (after.hooks.Stop[0].hooks[1].command !== "node /keep/me.mjs") throw new Error("sibling hook modified!");
  if (after.hooks.SessionStart[0].hooks[0].command !== "node /unrelated.mjs") throw new Error("unrelated entry modified!");

  // idempotent second run
  const r2 = bash([INSTALLER, "--apply"]);
  if (r2.status !== 0) throw new Error(`second --apply failed: ${r2.stderr}`);
  if (!/no matching entries|already installed/.test(r2.stdout)) throw new Error(`not idempotent: ${r2.stdout}`);

  // rollback restores original file
  const r3 = bash([INSTALLER, "--rollback"]);
  if (r3.status !== 0) throw new Error(`rollback failed: ${r3.stderr}`);
  const restored = JSON.parse(readFileSync(CONFIG, "utf8"));
  if (restored.hooks.PreToolUse[0].hooks[0].command !== cfg.hooks.PreToolUse[0].hooks[0].command)
    throw new Error("rollback did not restore original command");
});
