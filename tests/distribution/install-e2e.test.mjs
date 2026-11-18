// Distribution e2e: install -> verify -> idempotent -> stale-path migrate ->
// doctor -> rollback -> uninstall (data kept), all inside an isolated HOME.
// agentmemory is stubbed on PATH so the deps path is exercised offline.
// Run: node --test tests/distribution/install-e2e.test.mjs
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const PKG = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "release", "agent-learning-macos");
const ROOT = mkdtempSync(join(tmpdir(), "dist-e2e-"));
const HOME = join(ROOT, "home");
const BIN = join(ROOT, "bin");                       // stub dir on PATH
const GUARD = join(HOME, ".agent-learning", "guard");
const CONFIG = join(HOME, ".config", "devin", "config.json");
const SKILLS = join(HOME, ".config", "devin", "skills");
mkdirSync(HOME, { recursive: true }); mkdirSync(BIN, { recursive: true });
process.on("exit", () => rmSync(ROOT, { recursive: true, force: true }));

// stub agentmemory: records calls, healthy status
writeFileSync(join(BIN, "agentmemory"), `#!/usr/bin/env bash
echo "agentmemory $*" >> "${ROOT}/agentmemory.calls"
case "$1" in
  --version) echo "0.9.32";;
  status) echo "Connected — healthy";;
  connect) node -e '
    const fs=require("fs"),p=process.env.HOME+"/.config/devin/config.json";
    fs.mkdirSync(require("path").dirname(p),{recursive:true});
    const c=fs.existsSync(p)?JSON.parse(fs.readFileSync(p,"utf8")):{};
    c.mcpServers={...(c.mcpServers||{}),agentmemory:{command:"npx",args:["-y","@agentmemory/mcp"]}};
    c.hooks=c.hooks||{};
    const ev={UserPromptSubmit:"prompt-submit",PreToolUse:"pre-tool-use",PostToolUse:"post-tool-use",Stop:"stop",SessionEnd:"session-end",SessionStart:"session-start"};
    for(const[e,s]of Object.entries(ev)){(c.hooks[e]=c.hooks[e]||[]).push({hooks:[{type:"command",command:"node /am/plugin/scripts/"+s+".mjs"}]});}
    fs.writeFileSync(p,JSON.stringify(c,null,2));
  ';;
esac
exit 0`);
writeFileSync(join(BIN, "npm"), `#!/usr/bin/env bash
echo "npm $*" >> "${ROOT}/agentmemory.calls"; exit 0`);
for (const f of ["agentmemory", "npm"]) spawnSync("chmod", ["+x", join(BIN, f)]);

const env = () => ({ ...process.env, HOME, PATH: `${BIN}:${process.env.PATH}`,
  AGENT_LEARNING_HOME: join(HOME, ".agent-learning") });
const sh = (script, args = []) => spawnSync("bash", [join(PKG, script), ...args], { env: env(), encoding: "utf8", timeout: 30000 });
const cfg = () => JSON.parse(readFileSync(CONFIG, "utf8"));
const cmds = () => { const c = cfg(); const o = []; for (const a of Object.values(c.hooks || {})) a.forEach(e => (e.hooks || []).forEach(h => o.push(h.command || ""))); return o; };
const SHIMCMD = `node ${GUARD}/hook-shim.mjs`;

test("install: bundle + 4 hooks + skills land, deps invoked, receipt written", () => {
  mkdirSync(join(HOME, ".config", "devin"), { recursive: true });
  writeFileSync(join(HOME, ".config", "devin", "config.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: "node /unrelated.mjs" }] }] } }, null, 2));
  const r = sh("install.sh", ["--yes"]);
  if (r.status !== 0) throw new Error(`install failed:\n${r.stdout}\n${r.stderr}`);
  for (const f of ["hook-shim.mjs", "bin/guard.mjs", "bin/policy.json", "bin/session-context.mjs", "manifest.sha256", "install-receipt.json"])
    if (!existsSync(join(GUARD, f))) throw new Error(`missing ${f}`);
  const c = cmds();
  if (c.filter(x => x.startsWith(`${SHIMCMD} scripts/learning/guard/guard.mjs`)).length !== 3) throw new Error("guard shim not wired to 3 events");
  if (c.filter(x => x === `${SHIMCMD} scripts/learning/session-context.mjs`).length !== 1) throw new Error("session-context not wired");
  if (!c.includes("node /unrelated.mjs")) throw new Error("foreign hook lost!");
  for (const s of ["memory-recall", "error-triage", "self-repair", "lesson-distiller", "lesson-validator", "evidence-verifier", "learning-health"])
    if (!existsSync(join(SKILLS, s, "SKILL.md"))) throw new Error(`skill ${s} missing`);
  const calls = readFileSync(join(ROOT, "agentmemory.calls"), "utf8");
  if (!calls.includes("connect devin") || !calls.includes("status")) throw new Error(`deps path wrong: ${calls}`);
});

test("idempotent: second install changes nothing", () => {
  const r = sh("install.sh", ["--yes"]);
  if (r.status !== 0) throw new Error("reinstall failed");
  if (!/already up to date/.test(r.stdout)) throw new Error(`not idempotent: ${r.stdout}`);
});

test("stale repo/worktree hook paths migrate to shim on next install", () => {
  const c = cfg();
  c.hooks.Stop = [{ hooks: [{ type: "command", command: "node /some/deleted/worktree/scripts/learning/guard/guard.mjs" }] }];
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  const r = sh("install.sh", ["--yes"]);
  if (r.status !== 0) throw new Error("migrate run failed");
  if (!cmds().includes(`${SHIMCMD} scripts/learning/guard/guard.mjs`)) throw new Error("stale path not repointed");
  if (cmds().some(x => x.includes("worktree"))) throw new Error("worktree path survived");
});

test("doctor: PASS or PARTIAL only (no FAIL) on healthy install", () => {
  const r = sh("doctor.sh");
  if (r.status === 1) throw new Error(`doctor FAIL:\n${r.stdout}`);
  if (!/RESULT: (PASS|PARTIAL)/.test(r.stdout)) throw new Error(`bad doctor output: ${r.stdout}`);
  if (!/E03 block works/.test(r.stdout)) throw new Error("doctor did not verify E03");
});

test("doctor FAILs on corrupted bundle (hash mismatch detected)", () => {
  writeFileSync(join(GUARD, "bin", "policy.json"), "{}");
  const r = sh("doctor.sh");
  if (r.status !== 1 || !/hash mismatch|bundle/.test(r.stdout)) throw new Error(`corruption not detected: ${r.stdout}`);
});

test("rollback removes package changes only (differential)", () => {
  const r = sh("rollback.sh");
  if (r.status !== 0) throw new Error(`rollback failed: ${r.stderr}`);
  // differential semantics: our learning entries gone, foreign entries intact
  if (cmds().some(x => /scripts\/learning|agent-learning\/guard/.test(x)))
    throw new Error("learning hooks left after rollback");
  if (!cmds().includes("node /unrelated.mjs")) throw new Error("foreign hook lost by rollback");
});

test("P0-A: pre-existing foreign skill is backed up, not overwritten/deleted", () => {
  const foreign = join(SKILLS, "memory-recall");
  // simulate a colleague's pre-existing skill: same name, no ownership marker
  rmSync(foreign, { recursive: true, force: true });
  mkdirSync(foreign, { recursive: true });
  writeFileSync(join(foreign, "SKILL.md"), "# colleague's own memory-recall\n");
  const r = sh("install.sh", ["--yes"]);
  if (r.status !== 0) throw new Error("reinstall failed");
  // ours installed, theirs preserved aside
  if (readFileSync(join(foreign, "SKILL.md"), "utf8").includes("colleague's own"))
    throw new Error("foreign skill overwritten");
  if (!existsSync(join(foreign, ".agent-learning-owned"))) throw new Error("ownership marker missing");
  if (!readdirSync(SKILLS).some(f => f.startsWith("memory-recall.pre-agent-learning-")))
    throw new Error("foreign skill not backed up");
  // uninstall must NOT delete the foreign skill's backup and must restore nothing foreign
  const r2 = sh("uninstall.sh");
  if (r2.status !== 0) throw new Error("uninstall failed");
  if (!readdirSync(SKILLS).some(f => f.startsWith("memory-recall.pre-agent-learning-")))
    throw new Error("foreign skill backup deleted by uninstall!");
});

test("P0-B: rollback preserves hooks/MCP added AFTER install (differential)", () => {
  // fresh install first (previous test left us uninstalled)
  if (sh("install.sh", ["--yes"]).status !== 0) throw new Error("reinstall failed");
  // colleague adds their own hook + MCP afterwards
  const c = cfg();
  c.hooks.Stop.push({ hooks: [{ type: "command", command: "node /colleague/new-hook.mjs" }] });
  c.mcpServers = { mine: { command: "mine" } };
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  const r = sh("rollback.sh");
  if (r.status !== 0) throw new Error(`rollback failed: ${r.stderr}`);
  const after = cfg();
  // our learning hooks removed, colleague's additions intact
  if (cmds().some(x => /scripts\/learning|agent-learning\/guard/.test(x)))
    throw new Error("learning hooks left after rollback");
  if (!cmds().includes("node /colleague/new-hook.mjs")) throw new Error("post-install hook lost by rollback!");
  if (!after.mcpServers?.mine) throw new Error("post-install MCP config lost by rollback!");
});

test("uninstall removes our hooks+skills+dir, keeps memory data", () => {
  if (sh("install.sh", ["--yes"]).status !== 0) throw new Error("reinstall failed");
  mkdirSync(join(HOME, ".agentmemory"), { recursive: true });
  writeFileSync(join(HOME, ".agentmemory", "preferences.json"), "{}");
  const r = sh("uninstall.sh");
  if (r.status !== 0) throw new Error(`uninstall failed: ${r.stderr}`);
  if (existsSync(GUARD)) throw new Error("guard dir not removed");
  if (cmds().some(x => /scripts\/learning|agent-learning\/guard/.test(x))) throw new Error("learning hooks left in config");
  if (!existsSync(join(HOME, ".agentmemory", "preferences.json"))) throw new Error("memory data deleted without --purge-data!");
});

test("P0-C: --purge-data refuses without typed confirmation", () => {
  const r = spawnSync("bash", [join(PKG, "uninstall.sh"), "--purge-data"],
    { env: env(), input: "nope\n", encoding: "utf8" });
  if (!existsSync(join(HOME, ".agentmemory", "preferences.json")))
    throw new Error("purged without confirmation!");
  const r2 = spawnSync("bash", [join(PKG, "uninstall.sh"), "--purge-data"],
    { env: { ...env(), CONFIRM_PURGE: "DELETE-DATA" }, encoding: "utf8" });
  if (r2.status !== 0) throw new Error("confirmed purge failed");
  if (existsSync(join(HOME, ".agentmemory"))) throw new Error("purge did not run after confirmation");
});

test("P0-F: lifecycle works from the shipped tar.gz, not just the source tree", () => {
  const TARBALL = readdirSync(join(PKG, "..", "dist")).find(f => f.endsWith(".tar.gz"));
  if (!TARBALL) throw new Error("dist tarball missing — run the packaging step first");
  const X = join(ROOT, "extracted"); mkdirSync(X, { recursive: true });
  const t = spawnSync("tar", ["-xzf", join(PKG, "..", "dist", TARBALL), "-C", X], { encoding: "utf8" });
  if (t.status !== 0) throw new Error(`untar failed: ${t.stderr}`);
  const XPKG = join(X, "agent-learning-macos");
  const HOME3 = join(ROOT, "home3"); mkdirSync(HOME3, { recursive: true });
  const e3 = { ...process.env, HOME: HOME3, PATH: `${BIN}:${process.env.PATH}`, AGENT_LEARNING_HOME: join(HOME3, ".agent-learning") };
  const run = (s, a = []) => spawnSync("bash", [join(XPKG, s), ...a], { env: e3, encoding: "utf8", timeout: 30000 });
  if (run("install.sh", ["--yes"]).status !== 0) throw new Error("install from tarball failed");
  if (!existsSync(join(HOME3, ".agent-learning", "guard", "hook-shim.mjs"))) throw new Error("bundle missing after tarball install");
  const d = run("doctor.sh");
  if (d.status === 1) throw new Error(`doctor FAIL from tarball:\n${d.stdout}`);
  if (run("uninstall.sh").status !== 0) throw new Error("uninstall from tarball failed");
  if (existsSync(join(HOME3, ".agent-learning", "guard"))) throw new Error("guard dir left after tarball uninstall");
});

test("dry-run writes nothing", () => {
  const HOME2 = join(ROOT, "home2"); mkdirSync(HOME2, { recursive: true });
  const r = spawnSync("bash", [join(PKG, "install.sh"), "--dry-run"], {
    env: { ...process.env, HOME: HOME2, PATH: `${BIN}:${process.env.PATH}`, AGENT_LEARNING_HOME: join(HOME2, ".agent-learning") }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`dry-run exit ${r.status}: ${r.stderr}`);
  if (existsSync(join(HOME2, ".agent-learning")) || existsSync(join(HOME2, ".config", "devin", "config.json")))
    throw new Error("dry-run wrote files");
  if (!/DRY-RUN complete/.test(r.stdout)) throw new Error("missing dry-run marker");
});
