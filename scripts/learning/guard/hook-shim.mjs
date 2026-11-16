#!/usr/bin/env node
// agent-learning hook shim — stable-path entry point for user-level Devin hooks.
//
// Problem (Issue #6): hooks registered at paths INSIDE the git checkout
// (e.g. /Users/xiwei/agent-remote-poc/scripts/learning/...) die with
// MODULE_NOT_FOUND -> exit 1 -> "Hook failed" whenever the checkout's branch
// does not contain the learning scripts. Node crashes before guard.mjs can
// run its own fail-open path.
//
// Fix: this shim lives OUTSIDE the repo (installed to
// ~/.agent-learning/guard/hook-shim.mjs with a full runnable copy of the
// guard in ~/.agent-learning/guard/bin/) and delegates:
//   node hook-shim.mjs <repo-relative-script> [extra args...]
// Resolution order for the real script:
//   1. $AGENT_GUARD_HOME/<relpath>        (explicit repo root override)
//   2. <repo-root pointer file>/<relpath> (~/.agent-learning/guard/repo-root)
//   3. $HERE/bin/<basename>               (installed copy — branch-proof)
//
// Failure contract (PR#7 review remediation):
//   * NEVER exits non-zero, never throws.
//   * stdout is forwarded ONLY when the child exited 0 AND its output is a
//     complete, protocol-valid hook verdict (JSON object or empty). Partial
//     or malformed stdout of a failed child is dropped and audited.
//   * Failure policy is event-graded, parsed from the hook event JSON:
//       - PreToolUse: fail-CLOSED — emits a real `decision:block` verdict so
//         E03-class gates cannot silently pass when no verified guard ran.
//       - Stop / PostToolUse / SessionStart / unknown: fail-open, audited.
//   * Every failure AND success updates $AGENT_GUARD_DIR/health.json so the
//     degraded state is observable outside the jsonl audit trail.
import { existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = process.env.AGENT_GUARD_DIR || join(homedir(), ".agent-learning", "guard");
const POINTER = join(AUDIT_DIR, "repo-root");
const TIMEOUT_MS = Number(process.env.AGENT_GUARD_TIMEOUT_MS || 8000);

function audit(entry) {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(join(AUDIT_DIR, "audit.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
}

function health(status, extra = {}) {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    writeFileSync(join(AUDIT_DIR, "health.json"), JSON.stringify({ ts: new Date().toISOString(), status, ...extra }) + "\n");
  } catch {}
}

function emit(obj) {
  try { process.stdout.write(JSON.stringify(obj)); } catch {}
}

function eventNameOf(input) {
  try {
    const evt = JSON.parse(input);
    return typeof evt?.hook_event_name === "string" ? evt.hook_event_name : "unknown";
  } catch {
    return "unknown";
  }
}

function isValidVerdict(stdout) {
  // A complete hook verdict is empty (allow/no-op) or a JSON object.
  const s = String(stdout || "").trim();
  if (!s) return true;
  try {
    const v = JSON.parse(s);
    return v !== null && typeof v === "object" && !Array.isArray(v);
  } catch {
    return false;
  }
}

function candidates(rel) {
  const out = [];
  if (process.env.AGENT_GUARD_HOME) out.push(join(process.env.AGENT_GUARD_HOME, rel));
  try {
    const root = readFileSync(POINTER, "utf8").trim();
    if (root) out.push(join(root, rel));
  } catch {}
  out.push(join(HERE, "bin", basename(rel)));
  return out;
}

function failGracefully(rel, event, why, extra = {}) {
  audit({ shim: "guard-failure", rel, event, why, ...extra });
  health("degraded", { rel, event, why });
  if (event === "PreToolUse") {
    // Fail-closed: without a verified guard, E03-class policy would not run.
    emit({ decision: "block", reason: `[shim:guard-unavailable] ${why}. Guard could not run, so this action is blocked instead of silently passing. Restore the guard or ask the owner to review.` });
  }
}

function delegate(rel, input) {
  const event = eventNameOf(input);
  const rest = process.argv.slice(3);
  if (!rel || rel.includes("..") || rel.startsWith("/")) {
    failGracefully(rel, event, "bad-argv");
    return;
  }
  const target = candidates(rel).find((p) => existsSync(p));
  if (!target) {
    failGracefully(rel, event, "target-missing");
    return;
  }
  const r = spawnSync("node", [target, ...rest], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: TIMEOUT_MS,
    maxBuffer: 4 * 1024 * 1024,
  });
  const failed = r.error || r.status !== 0;
  if (failed) {
    const stderr = String(r.stderr || r.error?.message || "").slice(0, 500);
    failGracefully(rel, event, "child-error", {
      target, code: r.status ?? null, signal: r.signal ?? null, stderr,
    });
    return;
  }
  if (!isValidVerdict(r.stdout)) {
    failGracefully(rel, event, "bad-stdout", {
      target, stdoutExcerpt: String(r.stdout).slice(0, 300),
    });
    return;
  }
  if (r.stdout) process.stdout.write(r.stdout);
  health("ok", { rel, target });
}

try {
  let input = "";
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    try {
      delegate(process.argv[2], input);
    } catch (e) {
      failGracefully(process.argv[2], "unknown", "internal-error", { error: String(e).slice(0, 300) });
    }
    process.exit(0);
  });
  process.stdin.on("error", () => {
    audit({ shim: "stdin-error" });
    process.exit(0);
  });
} catch (e) {
  audit({ shim: "internal-error", error: String(e).slice(0, 300) });
  process.exit(0);
}
