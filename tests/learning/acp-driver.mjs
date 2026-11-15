// ACP driver for real Devin session UAT (Gate 2/3).
// Spawns `devin acp`, drives initialize/session/new/session/prompt.
// Auth policy (secure by default):
//   - NEVER calls `authenticate` unless ACP_ALLOW_BROWSER_AUTH=1 is explicitly
//     set — eliminates accidental browser popups. Run with ACP_BACKEND unset
//     so the server falls back to stored CLI credentials.
//   - Permission requests: deterministic whitelist for read-only commands
//     (echo/uname/date/pwd/ls/git status); everything else is denied.
// Logging: sanitized — method names, ids, field shapes, text lengths only.
// Usage: node acp-driver.mjs <workdir> <prompt> <transcript.jsonl> [timeoutSec]
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , cwd, prompt, transcript, timeoutArg] = process.argv;
const DEVIN = process.env.DEVIN_BIN || "/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin";
const TIMEOUT = Number(timeoutArg || 180) * 1000;
const ALLOW_BROWSER_AUTH = process.env.ACP_ALLOW_BROWSER_AUTH === "1";

// Read-only exec whitelist for permission decisions (UAT-safe).
const SAFE_CMD = /^\s*(echo\s|uname|date|pwd|ls|git\s+status|cat\s+[^\s;&|]+|head\b|true\b)/;
const isSafeCall = (tc) => {
  const name = tc?.title || tc?.kind || "";
  const cmd = tc?.rawInput?.command || tc?.input?.command || "";
  return SAFE_CMD.test(cmd) && !/[;&|`$()]/.test(cmd.replace(SAFE_CMD, ""));
};

mkdirSync(dirname(transcript), { recursive: true });
const sanitize = (m) => {
  const s = { t: Date.now() };
  if (m.id != null) s.id = m.id;
  if (m.method) s.method = m.method;
  if (m.error) s.error = { code: m.error.code, message: String(m.error.message || "").slice(0, 200) };
  if (m.result) {
    const r = m.result;
    s.result = { keys: Object.keys(r), sessionId: r.sessionId, agentName: r.agentInfo?.name, stopReason: r.stopReason };
  }
  if (m.params?.sessionId) s.sessionId = m.params.sessionId;
  if (m.method === "session/update") {
    const u = m.params?.update || {};
    s.update = { kind: u.sessionUpdate };
    if (u.sessionUpdate === "tool_call") s.update.toolKind = u.kind;
    const text = u.content?.text || u.text;
    if (typeof text === "string") s.update.textLen = text.length;
  }
  if (m.method === "session/request_permission") {
    const tc = m.params?.toolCall || {};
    s.request = { toolKind: tc.kind, titleLen: (tc.title || "").length };
  }
  return s;
};
const log = (dir, obj) => appendFileSync(transcript, JSON.stringify({ dir, ...sanitize(obj) }) + "\n");

const p = spawn(DEVIN, ["acp"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
let idc = 0;
const pending = new Map();

function respond(id, result) {
  const msg = { jsonrpc: "2.0", id, result };
  log("out-resp", msg);
  p.stdin.write(JSON.stringify(msg) + "\n");
}

p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    log("in", m);
    // Answer host-side requests so the session can proceed deterministically.
    if (m.method === "session/request_permission" && m.id != null) {
      const tc = m.params?.toolCall || {};
      const opts = m.params?.options || [];
      const allow = isSafeCall(tc) && opts.find((o) => /allow/i.test(o.kind || o.optionId || ""));
      if (allow) {
        respond(m.id, { outcome: { outcome: "selected", optionId: allow.optionId } });
      } else {
        const deny = opts.find((o) => /reject|deny/i.test(o.kind || o.optionId || ""));
        respond(m.id, deny
          ? { outcome: { outcome: "selected", optionId: deny.optionId } }
          : { outcome: { outcome: "cancelled" } });
      }
      return;
    }
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});

const call = (method, params) => new Promise((res) => {
  const id = ++idc; pending.set(id, res);
  const msg = { jsonrpc: "2.0", id, method, params };
  log("out", msg); p.stdin.write(JSON.stringify(msg) + "\n");
});
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const bail = (code) => { p.kill(); process.exit(code); };
setTimeout(() => bail(3), TIMEOUT);

const init = await call("initialize", { protocolVersion: 1, clientCapabilities: {} });
if (init.error) { console.error("init failed", init.error); bail(2); }
console.log("INIT", init.result?.agentInfo?.name || "ok");

if (ALLOW_BROWSER_AUTH) {
  const auth = await call("authenticate", { methodId: "devin-browser" });
  console.log("AUTH", auth.error ? JSON.stringify(auth.error) : "ok");
} else {
  console.log("AUTH skipped (default: no interactive auth; set ACP_ALLOW_BROWSER_AUTH=1 to enable)");
}

const ses = await call("session/new", { cwd, mcpServers: [] });
if (ses.error) { console.error("session/new failed", JSON.stringify(ses.error)); bail(2); }
const sessionId = ses.result?.sessionId;
console.log("SESSION", sessionId);

const done = await call("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] });
console.log("PROMPT_DONE", done.result?.stopReason || JSON.stringify(done.error || ""));
await sleep(1500);
bail(0);
