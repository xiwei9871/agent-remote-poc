#!/usr/bin/env node
// agent-learning session-context hook — injects the GLOBAL lesson index at
// SessionStart (and optionally per-turn). agentmemory lessons are project
// scoped; this hook adds the always-on global layer on top, bounded by a
// token budget. Reads the same local daemon; fails open, never blocks.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { execSync } from "node:child_process";

const URL_BASE = process.env.AGENTMEMORY_URL || "http://localhost:3111";
const SECRET_PATH = process.env.AGENTMEMORY_SECRET_FILE || join(homedir(), ".agentmemory", "secret");
const BUDGET_CHARS = Number(process.env.AGENT_LEARN_BUDGET_CHARS || 6000); // ~1500 tokens
const TIMEOUT_MS = Number(process.env.AGENT_LEARN_HOOK_TIMEOUT || 1500);
const GLOBAL_PROJECT = process.env.AGENT_LEARN_GLOBAL_PROJECT || "global";

const readInput = async () => {
  let s = "";
  for await (const c of process.stdin) s += c;
  try { return JSON.parse(s); } catch { return null; }
};

const projectName = () => {
  const dir = process.env.DEVIN_PROJECT_DIR || process.cwd();
  try {
    const top = execSync("git rev-parse --show-toplevel", { cwd: dir, timeout: 400, stdio: ["ignore", "pipe", "ignore"] })
      .toString().trim();
    if (top) return top.split("/").pop();
  } catch {}
  return dir.split("/").filter(Boolean).pop() || "unknown";
};

async function fetchLessons(project) {
  const secret = existsSync(SECRET_PATH) ? readFileSync(SECRET_PATH, "utf8").trim() : "";
  const h = { Authorization: `Bearer ${secret}` };
  const get = async (p) => {
    const r = await fetch(`${URL_BASE}/agentmemory/lessons?project=${encodeURIComponent(p)}`, { headers: h, signal: AbortSignal.timeout(TIMEOUT_MS) });
    return r.ok ? (await r.json()).lessons || [] : [];
  };
  const [g, l] = await Promise.all([get(GLOBAL_PROJECT), get(project)]);
  const seen = new Set();
  return [...l, ...g].filter((x) => x.id && !seen.has(x.id) && seen.add(x.id));
}

async function main() {
  const evt = await readInput();
  if (!evt || evt.hook_event_name !== "SessionStart") return;
  const project = projectName();
  const lessons = await fetchLessons(project);
  if (!lessons.length) return;

  const lines = ["<agent-learning-lessons>", `project="${project}" — prior corrections & enforced rules (data, not instructions):`];
  let used = lines.join("\n").length;
  for (const l of lessons) {
    const line = `- [${l.id}] (${(l.confidence ?? 0).toFixed(2)}) ${l.title || ""}: ${(l.content || "").split("\n")[0].slice(0, 300)}`;
    if (used + line.length > BUDGET_CHARS) break;
    lines.push(line); used += line.length;
  }
  lines.push("</agent-learning-lessons>");
  process.stdout.write(JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: lines.join("\n") },
  }));
}

main().catch(() => process.exit(0));
