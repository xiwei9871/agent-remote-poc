// Unit tests for guard.mjs — synthetic Devin hook payloads via child process.
// Run: node --test scripts/learning/guard/guard.test.mjs
import { test } from "node:test";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
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
  run(postExec("git push origin main", "To github.com:x/y.git  main -> main", true), "e05b");
  const r = run(stop, "e05b");
  if (r.out?.decision !== "block") throw new Error(`expected block on unverified delivery, got ${r.stdout}`);
});

test("E05: failed push does not force verify-block", () => {
  run(postExec("git push origin main", "fatal: remote error", false), "e05b2");
  const r = run(stop, "e05b2");
  if (r.out?.decision === "block") throw new Error(`failed push should not count as delivered, got ${r.stdout}`);
});

test("E05: stop after push + ls-remote passes", () => {
  run(postExec("git push origin main", "To github.com:x/y.git  main -> main", true), "e05c");
  run(postExec("git ls-remote origin main", "a1c1a05735037ca2b1f939d94781198cecf640db\trefs/heads/main", true), "e05c");
  const r = run(stop, "e05c");
  if (r.out?.decision === "block") throw new Error(`verified push should pass, got ${r.stdout}`);
});

test("E05: ls-remote with no SHA output does not count", () => {
  run(postExec("git push origin main", "To github.com:x/y.git", true), "e05d");
  run(postExec("git ls-remote origin main", "", true), "e05d");
  const r = run(stop, "e05d");
  if (r.out?.decision !== "block") throw new Error(`empty ls-remote should still block, got ${r.stdout}`);
});

test("E05: strict — ls-remote containing local HEAD passes, mismatch blocks", () => {
  const repo = dirname(dirname(dirname(fileURLToPath(import.meta.url)))); // agent-remote-poc
  const head = spawnSync("git", ["-C", repo, "rev-parse", "HEAD"], { encoding: "utf8" }).stdout.trim();
  const post = (command, output, cwd) => ({
    hook_event_name: "PostToolUse", tool_name: "exec",
    tool_input: { command }, tool_response: { success: true, output, error: null }, cwd,
  });
  run(post("git push origin main", "ok"), "e05e");
  run(post("git ls-remote origin main", `${head}\trefs/heads/main`, repo), "e05e");
  const ok = run(stop, "e05e");
  if (ok.out?.decision === "block") throw new Error(`HEAD match should pass, got ${ok.stdout}`);
  run(post("git push origin main", "ok"), "e05f");
  run(post("git ls-remote origin main", `${"0".repeat(40)}\trefs/heads/main`, repo), "e05f");
  const bad = run(stop, "e05f");
  if (bad.out?.decision !== "block") throw new Error(`SHA mismatch should block, got ${bad.stdout}`);
});

test("E01: commit message mentioning auto-approve is not blocked", () => {
  const r = run(execPre("git commit -m 'restrict auto-approve scope'"), "e01c");
  if (r.out?.decision === "block") throw new Error(`commit msg should not trigger E01, got ${r.stdout}`);
});

test("E01: exec code auto-answering request_permission is blocked", () => {
  const r = run(execPre("node -e 'on(\"session/request_permission\", () => respond(allow_once))'"), "e01d");
  if (r.out?.decision !== "block") throw new Error(`expected block, got ${r.stdout}`);
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

test("missing/corrupt policy.json exits 0 and audits internal-error (Issue #6)", () => {
  for (const bad of [join(DIR, "no-such-policy.json"), null]) {
    let p = bad;
    if (!p) { p = join(DIR, "corrupt-policy.json"); writeFileSync(p, "{not json"); }
    const sub = join(DIR, `aud-${p.endsWith("corrupt-policy.json") ? "corrupt" : "missing"}`);
    const r = spawnSync("node", [GUARD], {
      input: JSON.stringify({ session_id: "pol", hook_event_name: "Stop", tool_input: {} }),
      env: { ...process.env, AGENT_GUARD_DIR: sub, AGENT_GUARD_POLICY: p },
      encoding: "utf8", timeout: 10000,
    });
    if (r.status !== 0) throw new Error(`expected exit 0 with bad policy, got ${r.status}`);
    const log = readFileSync(join(sub, "audit.jsonl"), "utf8");
    if (!log.includes("internal-error")) throw new Error(`expected internal-error audit, got ${log}`);
  }
});
