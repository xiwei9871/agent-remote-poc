// Regression tests for hook-shim.mjs — Issue #6 + PR#7 remediation.
// Run: node --test scripts/learning/guard/hook-shim.test.mjs
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHIM = join(dirname(fileURLToPath(import.meta.url)), "hook-shim.mjs");
const DIR = mkdtempSync(join(tmpdir(), "shim-test-"));
const FAKE_REPO = join(DIR, "repo");
mkdirSync(join(FAKE_REPO, "scripts/learning/guard"), { recursive: true });
process.on("exit", () => rmSync(DIR, { recursive: true, force: true }));

const PRE = JSON.stringify({ session_id: "x", hook_event_name: "PreToolUse", tool_name: "exec", tool_input: { command: "ls" } });
const STOP = JSON.stringify({ session_id: "x", hook_event_name: "Stop" });

function run(args, stdin = "{}", env = {}) {
  const r = spawnSync("node", [SHIM, ...args], {
    input: stdin,
    env: { ...process.env, AGENT_GUARD_DIR: DIR, AGENT_GUARD_HOME: "", ...env },
    encoding: "utf8",
    timeout: 15000,
  });
  return { code: r.status, stdout: r.stdout, stderr: r.stderr };
}

function auditEntries() {
  try {
    return readFileSync(join(DIR, "audit.jsonl"), "utf8").split("\n").filter(Boolean).map(JSON.parse);
  } catch { return []; }
}
const last = (kind) => auditEntries().reverse().find((a) => a.shim === kind || a.why === kind);
const health = () => JSON.parse(readFileSync(join(DIR, "health.json"), "utf8"));

test("PreToolUse + missing target -> fail-CLOSED block verdict + degraded health", () => {
  const r = run(["scripts/learning/guard/guard.mjs"], PRE);
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  const v = JSON.parse(r.stdout);
  if (v.decision !== "block" || !/guard-unavailable/.test(v.reason))
    throw new Error(`expected fail-closed block, got ${r.stdout}`);
  if (!last("guard-failure") || last("guard-failure").why !== "target-missing")
    throw new Error("expected guard-failure/target-missing audit");
  if (health().status !== "degraded") throw new Error("expected degraded health.json");
});

test("Stop + missing target -> silent pass-through (fail-open) + audit", () => {
  const r = run(["scripts/learning/guard/guard.mjs"], STOP);
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  if (r.stdout.trim()) throw new Error(`expected no verdict for Stop, got ${r.stdout}`);
  if (last("guard-failure").why !== "target-missing") throw new Error("expected target-missing");
});

test("resolves via AGENT_GUARD_HOME and forwards valid verdict", () => {
  writeFileSync(join(FAKE_REPO, "scripts/learning/guard/guard.mjs"), 'let s="";for await (const c of process.stdin) s+=c;process.stdout.write(JSON.stringify({ok:true,payload:s.length}))');
  const stdin = JSON.stringify({ a: 1, pad: "x".repeat(50) });
  const r = run(["scripts/learning/guard/guard.mjs"], stdin, { AGENT_GUARD_HOME: FAKE_REPO });
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  const out = JSON.parse(r.stdout);
  if (!out.ok || out.payload !== stdin.length) throw new Error(`stdout not forwarded: ${r.stdout}`);
  if (health().status !== "ok") throw new Error("expected ok health");
});

test("resolves via repo-root pointer file", () => {
  writeFileSync(join(DIR, "repo-root"), FAKE_REPO + "\n");
  const r = run(["scripts/learning/guard/guard.mjs"], "{}", {});
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  if (!JSON.parse(r.stdout).ok) throw new Error(`pointer resolution failed: ${r.stdout}`);
});

test("crashing child: partial stdout DROPPED, audited, not forwarded", () => {
  writeFileSync(join(FAKE_REPO, "scripts/learning/guard/crash.mjs"), 'process.stdout.write("PARTIAL");console.error("boom detail");process.exit(1)');
  const r = run(["scripts/learning/guard/crash.mjs"], "{}", { AGENT_GUARD_HOME: FAKE_REPO });
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  if (r.stdout.includes("PARTIAL")) throw new Error(`partial stdout must not be forwarded: ${r.stdout}`);
  const e = last("guard-failure");
  if (!e || e.why !== "child-error" || e.code !== 1 || !e.stderr.includes("boom"))
    throw new Error("expected guard-failure/child-error audit with stderr excerpt");
});

test("PreToolUse + crashing guard -> fail-closed block", () => {
  const r = run(["scripts/learning/guard/crash.mjs"], PRE, { AGENT_GUARD_HOME: FAKE_REPO });
  const v = JSON.parse(r.stdout);
  if (v.decision !== "block") throw new Error(`expected block, got ${r.stdout}`);
});

test("exit0 child with malformed stdout -> dropped + audited", () => {
  writeFileSync(join(FAKE_REPO, "scripts/learning/guard/junk.mjs"), 'process.stdout.write("{not json");process.exit(0)');
  const r = run(["scripts/learning/guard/junk.mjs"], PRE, { AGENT_GUARD_HOME: FAKE_REPO });
  const v = JSON.parse(r.stdout);
  if (v.decision !== "block") throw new Error(`expected fail-closed on bad-stdout for PreToolUse, got ${r.stdout}`);
  if (last("guard-failure").why !== "bad-stdout") throw new Error("expected bad-stdout audit");
});

test("path-traversal argv rejected (audited, PreToolUse blocks)", () => {
  const r = run(["../../../etc/passwd"], PRE);
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  if (JSON.parse(r.stdout).decision !== "block") throw new Error("expected block for PreToolUse bad-argv");
  if (last("guard-failure").why !== "bad-argv") throw new Error("expected bad-argv audit");
});

test("empty stdin exits 0", () => {
  const r = run(["scripts/learning/guard/nope.mjs"], "");
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
});
