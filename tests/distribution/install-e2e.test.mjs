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

// stub agentmemory: records calls, healthy status; writes REAL script paths
// so doctor's dangling-hook check exercises the true pass path.
const FOREIGN = join(ROOT, "foreign"); mkdirSync(FOREIGN, { recursive: true });
for (const f of ["unrelated.mjs", "new-hook.mjs"]) writeFileSync(join(FOREIGN, f), "// foreign\n");
const UNRELATED = join(FOREIGN, "unrelated.mjs"), NEWHOOK = join(FOREIGN, "new-hook.mjs");
const AMLIB = join(ROOT, "node_modules", "@agentmemory", "agentmemory", "plugin", "scripts");
mkdirSync(AMLIB, { recursive: true });
for (const s of ["prompt-submit", "pre-tool-use", "post-tool-use", "stop", "session-end", "session-start"])
  writeFileSync(join(AMLIB, s + ".mjs"), "// stub agentmemory hook\n");
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
    for(const[e,s]of Object.entries(ev)){(c.hooks[e]=c.hooks[e]||[]).push({hooks:[{type:"command",command:"node ${AMLIB}/"+s+".mjs"}]});}
    fs.writeFileSync(p,JSON.stringify(c,null,2));
  '
    if [ "$AM_FAIL_CONNECT" = "1" ]; then echo "connect failed (simulated)" >&2; exit 1; fi;;
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
  writeFileSync(join(HOME, ".config", "devin", "config.json"), JSON.stringify({ hooks: { SessionStart: [{ hooks: [{ type: "command", command: `node ${UNRELATED}` }] }] } }, null, 2));
  const r = sh("install.sh", ["--yes"]);
  if (r.status !== 0) throw new Error(`install failed:\n${r.stdout}\n${r.stderr}`);
  for (const f of ["hook-shim.mjs", "bin/guard.mjs", "bin/policy.json", "bin/session-context.mjs", "manifest.sha256", "install-receipt.json"])
    if (!existsSync(join(GUARD, f))) throw new Error(`missing ${f}`);
  const c = cmds();
  if (c.filter(x => x.startsWith(`${SHIMCMD} scripts/learning/guard/guard.mjs`)).length !== 3) throw new Error("guard shim not wired to 3 events");
  if (c.filter(x => x.startsWith(`${SHIMCMD} scripts/learning/session-context.mjs`)).length !== 1) throw new Error("session-context not wired");
  // P0-R3: every installed learning hook carries a unique identity tag
  const tags = c.filter(x => x.startsWith(SHIMCMD)).map(x => x.match(/# AL-HOOK:([0-9a-f]+)$/)?.[1]);
  if (tags.length !== 4 || tags.some(t => !t)) throw new Error("learning hooks lack AL-HOOK identity tags");
  if (new Set(tags).size !== 4) throw new Error("AL-HOOK tags not unique");
  if (!c.includes(`node ${UNRELATED}`)) throw new Error("foreign hook lost!");
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
  if (!cmds().some(x => x.startsWith(`${SHIMCMD} scripts/learning/guard/guard.mjs`))) throw new Error("stale path not repointed");
  if (cmds().some(x => x.includes("worktree"))) throw new Error("worktree path survived");
});

test("doctor: PASS or PARTIAL only (no FAIL) on healthy install", () => {
  const r = sh("doctor.sh");
  if (r.status === 1) throw new Error(`doctor FAIL:\n${r.stdout}`);
  if (!/RESULT: (PASS|PARTIAL)/.test(r.stdout)) throw new Error(`bad doctor output: ${r.stdout}`);
  if (!/E03 block works/.test(r.stdout)) throw new Error("doctor did not verify E03");
  if (!/agentmemory 6 capture hooks registered/.test(r.stdout))
    throw new Error("doctor did not verify all 6 agentmemory hooks per-event");
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
  if (!cmds().includes(`node ${UNRELATED}`)) throw new Error("foreign hook lost by rollback");
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
  // uninstall restores the colleague's own version at the original path
  const r2 = sh("uninstall.sh");
  if (r2.status !== 0) throw new Error("uninstall failed");
  if (!existsSync(join(foreign, "SKILL.md"))) throw new Error("skill dir gone after uninstall");
  if (!readFileSync(join(foreign, "SKILL.md"), "utf8").includes("colleague's own"))
    throw new Error("colleague's own skill not restored at original path");
});

test("P0-B: rollback preserves hooks/MCP added AFTER install (differential)", () => {
  // fresh install first (previous test left us uninstalled)
  if (sh("install.sh", ["--yes"]).status !== 0) throw new Error("reinstall failed");
  // colleague adds their own hook + MCP afterwards
  const c = cfg();
  c.hooks.Stop.push({ hooks: [{ type: "command", command: `node ${NEWHOOK}` }] });
  c.mcpServers = { mine: { command: "mine" } };
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  const r = sh("rollback.sh");
  if (r.status !== 0) throw new Error(`rollback failed: ${r.stderr}`);
  const after = cfg();
  // our learning hooks removed, colleague's additions intact
  if (cmds().some(x => /scripts\/learning|agent-learning\/guard/.test(x)))
    throw new Error("learning hooks left after rollback");
  if (!cmds().includes(`node ${NEWHOOK}`)) throw new Error("post-install hook lost by rollback!");
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

test("P0-R2: two stale hooks -> same shim -> rollback restores EACH original", () => {
  // real scripts at two different checkouts so repoint is restorable
  const A = join(ROOT, "wt-A", "scripts", "learning", "guard");
  const B = join(ROOT, "wt-B", "scripts", "learning", "guard");
  mkdirSync(A, { recursive: true }); mkdirSync(B, { recursive: true });
  writeFileSync(join(A, "guard.mjs"), "// A"); writeFileSync(join(B, "guard.mjs"), "// B");
  const c = cfg();
  c.hooks.Stop = [
    { hooks: [{ type: "command", command: `node ${ROOT}/wt-A/scripts/learning/guard/guard.mjs` }] },
    { hooks: [{ type: "command", command: `node ${ROOT}/wt-B/scripts/learning/guard/guard.mjs` }] }];
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  if (sh("install.sh", ["--yes"]).status !== 0) throw new Error("install failed");
  if (sh("rollback.sh").status !== 0) throw new Error("rollback failed");
  const stops = cfg().hooks.Stop.flatMap(e => (e.hooks || []).map(h => h.command));
  if (!stops.includes(`node ${ROOT}/wt-A/scripts/learning/guard/guard.mjs`)) throw new Error("wt-A original not restored");
  if (!stops.includes(`node ${ROOT}/wt-B/scripts/learning/guard/guard.mjs`)) throw new Error("wt-B original not restored — mapped to wrong/shim command");
});

test("P0-R2: reinstall never overwrites a user-modified skill", () => {
  const dst = join(SKILLS, "self-repair");
  writeFileSync(join(dst, "SKILL.md"), "# user's edited self-repair\n");
  const r = sh("install.sh", ["--yes"]);
  if (r.status !== 0) throw new Error("reinstall failed");
  if (!readdirSync(SKILLS).some(f => f.startsWith("self-repair.user-modified-")))
    throw new Error("modified skill not preserved aside");
  if (readFileSync(join(dst, "SKILL.md"), "utf8").includes("user's edited"))
    throw new Error("still showing user content — not refreshed? check marker");
});

test("P0-R2: uninstall keeps colleague's extra files and restores own skill", () => {
  // user-modified self-repair is currently installed; give it an extra file
  writeFileSync(join(SKILLS, "self-repair", "notes.md"), "colleague notes");
  // make memory-recall foreign again with extra file
  const mr = join(SKILLS, "memory-recall");
  rmSync(mr, { recursive: true, force: true }); mkdirSync(mr, { recursive: true });
  writeFileSync(join(mr, "SKILL.md"), "# colleague's own\n");
  writeFileSync(join(mr, "extra.md"), "keep me");
  if (sh("install.sh", ["--yes"]).status !== 0) throw new Error("install failed");
  const r = sh("uninstall.sh");
  if (r.status !== 0) throw new Error("uninstall failed");
  // memory-recall: foreign backup restored at original path incl. extra file
  if (!existsSync(join(mr, "extra.md"))) throw new Error("colleague extra file lost");
  if (!readFileSync(join(mr, "SKILL.md"), "utf8").includes("colleague's own"))
    throw new Error("colleague's own SKILL.md not restored");
  // self-repair (user-modified) moved aside, not deleted
  if (!readdirSync(SKILLS).some(f => f.startsWith("self-repair.user-modified-")))
    throw new Error("user-modified skill dir deleted");
});

test("P0-R2: rollback on a no-agentmemory machine removes ALL connect changes", () => {
  const HOME4 = join(ROOT, "home4"); mkdirSync(HOME4, { recursive: true });
  const e4 = { ...process.env, HOME: HOME4, PATH: `${BIN}:${process.env.PATH}`, AGENT_LEARNING_HOME: join(HOME4, ".agent-learning") };
  const run = (s, a = []) => spawnSync("bash", [join(PKG, s), ...a], { env: e4, encoding: "utf8", timeout: 30000 });
  if (run("install.sh", ["--yes"]).status !== 0) throw new Error("fresh install failed");
  const c4 = () => JSON.parse(readFileSync(join(HOME4, ".config", "devin", "config.json"), "utf8"));
  if (!c4().mcpServers?.agentmemory) throw new Error("connect did not write mcpServers (stub path)");
  if (run("rollback.sh").status !== 0) throw new Error("rollback failed");
  const after = c4();
  if (after.mcpServers?.agentmemory) throw new Error("agentmemory MCP left after rollback");
  const leftover = Object.values(after.hooks || {}).flat().flatMap(e => (e.hooks || []).map(h => h.command || ""))
    .filter(c => /agentmemory|scripts\/learning|agent-learning\/guard/.test(c));
  if (leftover.length) throw new Error(`hooks left after full rollback: ${leftover}`);
});

test("P0-R3: reorder counterexample — rollback restores each entry's OWN original", () => {
  // The R3 reviewer's case: two stale hooks → same shim, then the colleague
  // REORDERS the entries. Position-paired rollback would swap A/B; tagged
  // identity must not.
  const A = join(ROOT, "r3-A", "scripts", "learning", "guard");
  const B = join(ROOT, "r3-B", "scripts", "learning", "guard");
  mkdirSync(A, { recursive: true }); mkdirSync(B, { recursive: true });
  writeFileSync(join(A, "guard.mjs"), "// A"); writeFileSync(join(B, "guard.mjs"), "// B");
  const c = cfg();
  c.hooks.Stop = [
    { matcher: "a", hooks: [{ type: "command", command: `node ${ROOT}/r3-A/scripts/learning/guard/guard.mjs` }] },
    { matcher: "b", hooks: [{ type: "command", command: `node ${ROOT}/r3-B/scripts/learning/guard/guard.mjs` }] }];
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  if (sh("install.sh", ["--yes"]).status !== 0) throw new Error("install failed");
  // colleague reorders: entry "b" now first
  const c2 = cfg();
  c2.hooks.Stop = [c2.hooks.Stop[1], c2.hooks.Stop[0]];
  writeFileSync(CONFIG, JSON.stringify(c2, null, 2));
  if (sh("rollback.sh").status !== 0) throw new Error("rollback failed");
  const stops = cfg().hooks.Stop;
  if (stops[0].hooks[0].command !== `node ${ROOT}/r3-B/scripts/learning/guard/guard.mjs`)
    throw new Error(`entry identity lost after reorder: ${stops[0].hooks[0].command}`);
  if (stops[1].hooks[0].command !== `node ${ROOT}/r3-A/scripts/learning/guard/guard.mjs`)
    throw new Error(`entry identity lost after reorder: ${stops[1].hooks[0].command}`);
});

test("P0-R3: failed connect restores pre-install config (transaction)", () => {
  const HOME5 = join(ROOT, "home5"); mkdirSync(HOME5, { recursive: true });
  const cfgDir = join(HOME5, ".config", "devin"); mkdirSync(cfgDir, { recursive: true });
  const preCfg = JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: "command", command: `node ${NEWHOOK}` }] }] } }, null, 2);
  writeFileSync(join(cfgDir, "config.json"), preCfg);
  const e5 = { ...process.env, HOME: HOME5, PATH: `${BIN}:${process.env.PATH}`,
    AGENT_LEARNING_HOME: join(HOME5, ".agent-learning"), AM_FAIL_CONNECT: "1" };
  const r = spawnSync("bash", [join(PKG, "install.sh"), "--yes"], { env: e5, encoding: "utf8", timeout: 30000 });
  if (r.status === 0) throw new Error("install unexpectedly succeeded with failing connect");
  if (!/config restored to pre-install snapshot/.test(r.stderr)) throw new Error(`no transaction restore: ${r.stderr}`);
  if (readFileSync(join(cfgDir, "config.json"), "utf8") !== preCfg)
    throw new Error("config mutated by failed install — transaction broken");
});

test("P0-R3: uninstall also removes agentmemory connect additions", () => {
  const HOME6 = join(ROOT, "home6"); mkdirSync(HOME6, { recursive: true });
  const e6 = { ...process.env, HOME: HOME6, PATH: `${BIN}:${process.env.PATH}`, AGENT_LEARNING_HOME: join(HOME6, ".agent-learning") };
  const run = (s, a = []) => spawnSync("bash", [join(PKG, s), ...a], { env: e6, encoding: "utf8", timeout: 30000 });
  if (run("install.sh", ["--yes"]).status !== 0) throw new Error("fresh install failed");
  if (run("uninstall.sh").status !== 0) throw new Error("uninstall failed");
  const c6 = JSON.parse(readFileSync(join(HOME6, ".config", "devin", "config.json"), "utf8"));
  const left = Object.values(c6.hooks || {}).flat().flatMap(e => (e.hooks || []).map(h => h.command || ""))
    .filter(x => /agentmemory|agent-learning\/guard|scripts\/learning/.test(x));
  if (left.length) throw new Error(`uninstall left hooks behind: ${left}`);
  if (c6.mcpServers?.agentmemory) throw new Error("uninstall left mcpServers.agentmemory");
});

test("P0-R3: doctor FAILs on dangling hook script paths", () => {
  const c = cfg();
  c.hooks.SessionEnd = [{ hooks: [{ type: "command", command: "node /does/not/exist/dead-hook.mjs" }] }];
  writeFileSync(CONFIG, JSON.stringify(c, null, 2));
  const r = sh("doctor.sh");
  if (r.status !== 1 || !/dangling/.test(r.stdout)) throw new Error(`dangling hook not caught: ${r.stdout}`);
  // cleanup: drop the dead entry
  const c2 = cfg(); c2.hooks.SessionEnd = []; writeFileSync(CONFIG, JSON.stringify(c2, null, 2));
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
