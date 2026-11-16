// Regression tests for hook-shim.mjs — Issue #6 (MODULE_NOT_FOUND -> exit 1).
// Run: node --test scripts/learning/guard/hook-shim.test.mjs
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const SHIM = join(dirname(fileURLToPath(import.meta.url)), "hook-shim.mjs");
const DIR = mkdtempSync(join(tmpdir(), "shim-test-"));
const FAKE_REPO = join(DIR, "repo");
mkdirSync(join(FAKE_REPO, "scripts/learning/guard"), { recursive: true });
process.on("exit", () => rmSync(DIR, { recursive: true, force: true }));

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

test("shim: missing target script exits 0 (was MODULE_NOT_FOUND -> exit 1)", () => {
  const before = auditEntries().length;
  const r = run(["scripts/learning/guard/guard.mjs"], JSON.stringify({ session_id: "x", hook_event_name: "Stop" }));
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}: ${r.stderr}`);
  const e = auditEntries().slice(before).find((a) => a.shim === "target-missing");
  if (!e) throw new Error("expected target-missing audit entry");
});

test("shim: resolves target via AGENT_GUARD_HOME and forwards stdout", () => {
  writeFileSync(join(FAKE_REPO, "scripts/learning/guard/guard.mjs"), 'let s="";for await (const c of process.stdin) s+=c;process.stdout.write(JSON.stringify({ok:true,payload:s.length}))');
  const stdin = JSON.stringify({ a: 1, pad: "x".repeat(50) });
  const r = run(["scripts/learning/guard/guard.mjs"], stdin, { AGENT_GUARD_HOME: FAKE_REPO });
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  const out = JSON.parse(r.stdout);
  if (!out.ok || out.payload !== stdin.length) throw new Error(`stdout not forwarded: ${r.stdout}`);
});

test("shim: resolves target via repo-root pointer file", () => {
  writeFileSync(join(DIR, "repo-root"), FAKE_REPO + "\n");
  const r = run(["scripts/learning/guard/guard.mjs"], "{}", {});
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  if (!JSON.parse(r.stdout).ok) throw new Error(`pointer resolution failed: ${r.stdout}`);
});

test("shim: crashing child is audited, still exits 0, stdout forwarded", () => {
  writeFileSync(join(FAKE_REPO, "scripts/learning/guard/crash.mjs"), 'process.stdout.write("PARTIAL");console.error("boom detail");process.exit(1)');
  const before = auditEntries().length;
  const r = run(["scripts/learning/guard/crash.mjs"], "{}", { AGENT_GUARD_HOME: FAKE_REPO });
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  if (r.stdout !== "PARTIAL") throw new Error(`expected forwarded stdout, got ${r.stdout}`);
  const e = auditEntries().slice(before).find((a) => a.shim === "child-error" && a.code === 1);
  if (!e || !e.stderr.includes("boom")) throw new Error("expected child-error audit with stderr excerpt");
});

test("shim: path-traversal argv rejected, exits 0", () => {
  const before = auditEntries().length;
  const r = run(["../../../etc/passwd"], "{}");
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
  if (!auditEntries().slice(before).some((a) => a.shim === "bad-argv")) throw new Error("expected bad-argv audit");
});

test("shim: empty stdin exits 0", () => {
  const r = run(["scripts/learning/guard/nope.mjs"], "");
  if (r.code !== 0) throw new Error(`expected exit 0, got ${r.code}`);
});
