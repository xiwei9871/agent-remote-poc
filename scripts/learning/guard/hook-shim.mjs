#!/usr/bin/env node
// agent-learning hook shim — stable-path entry point for user-level Devin hooks.
//
// Problem (Issue #6): hooks registered at paths INSIDE the git checkout
// (e.g. /Users/xiwei/agent-remote-poc/scripts/learning/...) die with
// MODULE_NOT_FOUND -> exit 1 -> "Hook failed" whenever the checkout's branch
// does not contain the learning scripts (e.g. after switching to a DSH/GPR
// work branch). Node crashes before guard.mjs can run its own fail-open path.
//
// Fix: this shim lives OUTSIDE the repo (installed once to
// ~/.agent-learning/guard/hook-shim.mjs) and delegates:
//   node hook-shim.mjs <repo-relative-script> [extra args...]
// Resolution order for the real script:
//   1. $AGENT_GUARD_HOME/<relpath>   (explicit repo root override)
//   2. <repo-root pointer file>/<relpath>   (~/.agent-learning/guard/repo-root,
//      written by install-shim.sh — survives branch switches)
//   3. $GUARD_BIN_DIR/<basename>     (installed copy fallback, same dir)
// Contract: NEVER exits non-zero, never throws. Missing/crashing target is
// audited to ~/.agent-learning/guard/audit.jsonl and the hook passes through
// (fail-open). Child stdout is forwarded verbatim so JSON decisions
// (decision:block / additionalContext) still reach the host.
import { existsSync, readFileSync, appendFileSync, mkdirSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { homedir } from "node:os";
import { basename, dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const AUDIT_DIR = process.env.AGENT_GUARD_DIR || join(homedir(), ".agent-learning", "guard");
const POINTER = join(AUDIT_DIR, "repo-root");

function audit(entry) {
  try {
    mkdirSync(AUDIT_DIR, { recursive: true });
    appendFileSync(join(AUDIT_DIR, "audit.jsonl"), JSON.stringify({ ts: new Date().toISOString(), ...entry }) + "\n");
  } catch {}
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

function delegate(rel, input) {
  const rest = process.argv.slice(3);
  if (!rel || rel.includes("..") || rel.startsWith("/")) {
    audit({ shim: "bad-argv", rel: rel ?? null });
    return;
  }
  const target = candidates(rel).find((p) => existsSync(p));
  if (!target) {
    audit({ shim: "target-missing", rel });
    return;
  }
  const r = spawnSync("node", [target, ...rest], {
    input,
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: Number(process.env.AGENT_GUARD_TIMEOUT_MS || 8000),
    maxBuffer: 4 * 1024 * 1024,
  });
  if (r.stdout) process.stdout.write(r.stdout);
  if (r.error || r.status !== 0) {
    const stderr = String(r.stderr || r.error?.message || "").slice(0, 500);
    audit({ shim: "child-error", rel, target, code: r.status ?? null, signal: r.signal ?? null, stderr });
  }
}

try {
  // Pipe raw stdin through to the child unchanged.
  let input = "";
  process.stdin.on("data", (c) => (input += c));
  process.stdin.on("end", () => {
    try {
      delegate(process.argv[2], input);
    } catch (e) {
      audit({ shim: "internal-error", error: String(e).slice(0, 300) });
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
