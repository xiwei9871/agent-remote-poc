#!/usr/bin/env node
// agent-learning guard hook — deterministic PreToolUse/Stop policy for Devin CLI.
// Contract: stdin = hook event JSON; stdout JSON controls outcome
//   (decision:block / hookSpecificOutput.additionalContext). Exit 2 = block.
// Fail-open on internal errors; every decision is audit-logged.
import { appendFileSync, mkdirSync, readFileSync, existsSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GUARD_DIR = process.env.AGENT_GUARD_DIR || join(homedir(), ".agent-learning", "guard");
const POLICY_PATH = process.env.AGENT_GUARD_POLICY || join(HERE, "policy.json");

const loadPolicy = () => JSON.parse(readFileSync(POLICY_PATH, "utf8"));

function audit(entry) {
  try {
    mkdirSync(GUARD_DIR, { recursive: true });
    appendFileSync(join(GUARD_DIR, "audit.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

function sessionLog(sessionId) {
  const dir = join(GUARD_DIR, "sessions");
  mkdirSync(dir, { recursive: true });
  return join(dir, `${String(sessionId || "unknown").replace(/[^\w.-]/g, "_")}.jsonl`);
}

function record(sessionId, event) {
  try { appendFileSync(sessionLog(sessionId), JSON.stringify({ ts: new Date().toISOString(), ...event }) + "\n"); } catch {}
}

function readSignals(sessionId) {
  const p = sessionLog(sessionId);
  const sig = { pushed: false, verified: false, testFailed: false, testPassedAfter: false, deliverClaim: false };
  if (!existsSync(p)) return sig;
  let lines;
  try { lines = readFileSync(p, "utf8").split("\n"); } catch { return sig; }
  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const e = JSON.parse(line);
      if (e.sig === "pushed") sig.pushed = true;
      if (e.sig === "verified-remote") sig.verified = true;
      if (e.sig === "test-failed") { sig.testFailed = true; sig.testPassedAfter = false; }
      if (e.sig === "test-passed") sig.testPassedAfter = true;
      if (e.sig === "deliver-claim") sig.deliverClaim = true;
    } catch {}
  }
  return sig;
}

const PUSH_RE = /git\s+push\b/;
const VERIFY_RE = /git\s+ls-remote|gh\s+(api|pr\s+view)|refs\/heads/;
const SHA_RE = /[0-9a-f]{40}/;

// Resolve local HEAD for strict remote==local comparison. Returns null when
// cwd is unknown/not a repo — the check then falls back to output shape only.
function headSha(evt) {
  const cwd = evt.cwd || evt.tool_input?.cwd || null;
  if (!cwd) return null;
  try {
    const r = spawnSync("git", ["-C", cwd, "rev-parse", "HEAD"], { encoding: "utf8", timeout: 3000 });
    const sha = (r.stdout || "").trim();
    return /^[0-9a-f]{40}$/.test(sha) ? sha : null;
  } catch { return null; }
}
const TEST_CMD_RE = /\b(pytest|unittest|npm\s+(test|run\s+test)|vitest|jest|cargo\s+test|go\s+test|node\s+--test)\b/;
const FAIL_OUT_RE = /\b(failed|failure|FAILED|AssertionError|FAIL\b|✗|not ok)\b/;
const PASS_OUT_RE = /\b(ok|passed|PASS|✓|all tests? passed)\b/i;

function classifyToolEvent(evt) {
  const name = evt.tool_name || "";
  const input = evt.tool_input || {};
  const cmd = typeof input.command === "string" ? input.command : "";
  if (evt.hook_event_name === "PostToolUse") {
    const out = String(evt.tool_response?.output ?? "") + String(evt.tool_response?.error ?? "");
    const ok = evt.tool_response?.success !== false;
    // Delivery signals only count on observed success, not on command intent.
    if (PUSH_RE.test(cmd) && ok && !/(rejected|error:|fatal:|failed)/i.test(out)) return "pushed";
    // ls-remote must return real ref SHAs; when local HEAD is resolvable the
    // output must contain it (strict remote==local). Otherwise attempt-level.
    if (VERIFY_RE.test(cmd) && ok && SHA_RE.test(out)) {
      const head = headSha(evt);
      if (head && !out.includes(head)) return "verify-mismatch";
      return "verified-remote";
    }
    if (TEST_CMD_RE.test(cmd)) {
      if (evt.tool_response?.success === false || FAIL_OUT_RE.test(out)) return "test-failed";
      if (PASS_OUT_RE.test(out)) return "test-passed";
    }
  }
  return null;
}

function fieldValue(evt, field) {
  if (field === "any") return JSON.stringify(evt.tool_input || {});
  return field.split(".").reduce((o, k) => (o && o[k] != null ? o[k] : ""), evt) || "";
}

function matchRule(rule, evt) {
  if (!rule.events.includes(evt.hook_event_name)) return false;
  if (rule.events.includes("PreToolUse") && evt.hook_event_name === "PreToolUse") {
    if (rule.tools.length && !rule.tools.includes(evt.tool_name)) return false;
    const hay = fieldValue(evt, rule.match?.field || "any");
    if (!rule.match || !new RegExp(rule.match.regex).test(hay)) return false;
    if (rule.requireAbsent && new RegExp(rule.requireAbsent).test(hay)) return false;
    return true;
  }
  if (rule.events.includes("Stop") && evt.hook_event_name === "Stop") return true;
  return false;
}

function emit(obj) {
  try { process.stdout.write(JSON.stringify(obj)); } catch (e) { audit({ kind: "internal-error", where: "emit", error: String(e).slice(0, 300) }); }
}

async function main() {
  let input = "";
  for await (const chunk of process.stdin) input += chunk;
  let evt;
  try { evt = JSON.parse(input); } catch { return; }
  if (!evt || typeof evt !== "object") return;

  const sid = evt.session_id || "unknown";
  const policy = loadPolicy();

  // Track evidence signals for Stop-time checks.
  const sig = classifyToolEvent(evt);
  if (sig) record(sid, { sig, tool: evt.tool_name, prompt: evt.prompt_id });

  for (const rule of policy.rules) {
    if (!matchRule(rule, evt)) continue;

    if (evt.hook_event_name === "Stop" && rule.sessionSignal) {
      const s = readSignals(sid);
      const hit =
        (rule.sessionSignal === "pushed-not-verified" && s.pushed && !s.verified) ||
        (rule.sessionSignal === "test-failed-unresolved" && s.testFailed && !s.testPassedAfter) ||
        (rule.sessionSignal === "claim-without-evidence" && (s.pushed || s.testFailed));
      if (!hit) continue;
    }

    audit({ evt: evt.hook_event_name, rule: rule.id, mode: rule.mode, session: sid, tool: evt.tool_name });
    if (rule.mode === "block") {
      emit({ decision: "block", reason: `[guard:${rule.id}] ${rule.reason}` });
      return;
    }
    emit({ hookSpecificOutput: { hookEventName: evt.hook_event_name, additionalContext: `[guard:${rule.id}] WARN ${rule.reason}` } });
    return;
  }
}

main().catch((e) => { audit({ kind: "internal-error", error: String(e).slice(0, 500) }); process.exit(0); });
