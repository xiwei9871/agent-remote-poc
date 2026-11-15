// Unit tests for guard.mjs — synthetic Devin hook payloads via child process.
// Run: node --test scripts/learning/guard/guard.test.mjs
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const GUARD = join(dirname(fileURLToPath(import.meta.url)), "guard.mjs");
const DIR = mkdtempSync(join(tmpdir(), "guard-test-"));
process.on("exit", () => rmSync(DIR, { recursive: true, force: true }));

function run(payload, sessionId = "s1") {
  const r = spawnSync("node", [GUARD], {
    input: JSON.stringify({ session_id: sessionId, ...payload }),
    env: { ...process.env, AGENT_GUARD_DIR: DIR },
    encoding: "utf8",
    timeout: 10000,
  });
  return { stdout: r.stdout.trim(), code: r.status, out: r.stdout.trim() ? JSON.parse(r.stdout) : null };
}

const execPre = (command) => ({ hook_event_name: "PreToolUse", tool_name: "exec", tool_input: { command } });
const postExec = (command, output, success = true) => ({
  hook_event_name: "PostToolUse", tool_name: "exec",
  tool_input: { command }, tool_response: { success, output, error: null },
});
const stop = { hook_event_name: "Stop", tool_input: {} };

test("E03: bare pkill -f is blocked", () => {
  const r = run(execPre("pkill -f 'dsh web'"), "e03a");
  if (r.out?.decision !== "block") throw new Error(`expected block, got ${r.stdout}`);
});

test("E03: pkill with ownership check pattern passes", () => {
  const r = run(execPre("for pid in $(pgrep -f dsh); do lsof -p $pid -d cwd; done && kill $pid"), "e03b");
  if (r.out?.decision === "block") throw new Error("should not block verified kill");
});

test("E01: writing auto-approve code is blocked", () => {
  const r = run({
    hook_event_name: "PreToolUse", tool_name: "write",
    tool_input: { file_path: "probe.mjs", content: "pick allow_once option and reply" },
  }, "e01a");
  if (r.out?.decision !== "block") throw new Error(`expected block, got ${r.stdout}`);
});

test("E01: auto-approve with allow-root gate passes", () => {
  const r = run({
    hook_event_name: "PreToolUse", tool_name: "write",
    tool_input: { file_path: "probe.mjs", content: "if (autoApprove && withinAllowRoot) allow_once" },
  }, "e01b");
  if (r.out?.decision === "block") throw new Error(`should pass gated auto-approve, got ${r.stdout}`);
});

test("E05: git push warns at exec time", () => {
  const r = run(execPre("git push origin main"), "e05a");
  if (r.out?.decision === "block") throw new Error("push itself should warn, not block");
  if (!r.out?.hookSpecificOutput?.additionalContext?.includes("E05")) throw new Error(`expected warn context, got ${r.stdout}`);
});

test("E05: stop after push without ls-remote is blocked", () => {
  run(execPre("git push origin main"), "e05b");
  const r = run(stop, "e05b");
  if (r.out?.decision !== "block") throw new Error(`expected block on unverified delivery, got ${r.stdout}`);
});

test("E05: stop after push + ls-remote passes", () => {
  run(execPre("git push origin main"), "e05c");
  run(execPre("git ls-remote origin main"), "e05c");
  const r = run(stop, "e05c");
  if (r.out?.decision === "block") throw new Error(`verified push should pass, got ${r.stdout}`);
});

test("E02: stop after failed test warns", () => {
  run(postExec("npm test", "1 failed, 9 passed", false), "e02a");
  const r = run(stop, "e02a");
  if (!r.out?.hookSpecificOutput?.additionalContext?.includes("E02")) throw new Error(`expected E02 warn, got ${r.stdout}`);
});

test("E02: stop after failed then passed test is quiet", () => {
  run(postExec("npm test", "1 failed", false), "e02b");
  run(postExec("npm test", "10 passed", true), "e02b");
  const r = run(stop, "e02b");
  if (r.out?.hookSpecificOutput?.additionalContext?.includes("E02")) throw new Error(`should not warn, got ${r.stdout}`);
});

test("benign exec passes silently", () => {
  const r = run(execPre("git status"), "benign");
  if (r.stdout) throw new Error(`expected silence, got ${r.stdout}`);
});

test("malformed input exits cleanly", () => {
  const r = spawnSync("node", [GUARD], { input: "not json", env: { ...process.env, AGENT_GUARD_DIR: DIR }, encoding: "utf8" });
  if (r.status !== 0) throw new Error(`expected exit 0, got ${r.status}`);
});
