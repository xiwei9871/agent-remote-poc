// ACP driver for real Devin session UAT (Gate 2).
// Spawns `devin acp`, drives initialize/authenticate/session/new/session/prompt,
// logs every JSON-RPC message to a JSONL transcript for evidence.
// Usage: node acp-driver.mjs <workdir> <prompt> <transcript.jsonl> [timeoutSec]
import { spawn } from "node:child_process";
import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

const [, , cwd, prompt, transcript, timeoutArg] = process.argv;
const DEVIN = process.env.DEVIN_BIN || "/Applications/Devin.app/Contents/Resources/app/extensions/windsurf/devin/bin/devin";
const TIMEOUT = Number(timeoutArg || 180) * 1000;

mkdirSync(dirname(transcript), { recursive: true });
const log = (dir, obj) => appendFileSync(transcript, JSON.stringify({ t: Date.now(), dir, ...obj }) + "\n");

const p = spawn(DEVIN, ["acp"], { cwd, stdio: ["pipe", "pipe", "inherit"] });
let buf = "";
let idc = 0;
const pending = new Map();
p.stdout.on("data", (d) => {
  buf += d;
  let i;
  while ((i = buf.indexOf("\n")) >= 0) {
    const line = buf.slice(0, i); buf = buf.slice(i + 1);
    if (!line.trim()) continue;
    let m; try { m = JSON.parse(line); } catch { continue; }
    log("in", m);
    if (m.id != null && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
  }
});
const call = (method, params) => new Promise((res) => {
  const id = ++idc; pending.set(id, res);
  const msg = { jsonrpc: "2.0", id, method, params };
  log("out", msg); p.stdin.write(JSON.stringify(msg) + "\n");
});
const notify = (method, params) => { const msg = { jsonrpc: "2.0", method, params }; log("out", msg); p.stdin.write(JSON.stringify(msg) + "\n"); };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const bail = (code) => { p.kill(); process.exit(code); };
setTimeout(() => bail(3), TIMEOUT);

const init = await call("initialize", { protocolVersion: 1, clientCapabilities: {} });
if (init.error) { console.error("init failed", init.error); bail(2); }
console.log("INIT", init.result?.agentInfo?.name || "ok");

const auth = await call("authenticate", { methodId: "devin-browser" });
console.log("AUTH", auth.error ? JSON.stringify(auth.error) : "ok");

const ses = await call("session/new", { cwd, mcpServers: [] });
if (ses.error) { console.error("session/new failed", JSON.stringify(ses.error)); bail(2); }
const sessionId = ses.result?.sessionId;
console.log("SESSION", sessionId);

await call("session/prompt", { sessionId, prompt: [{ type: "text", text: prompt }] });
console.log("PROMPT_DONE");
await sleep(1500);
bail(0);
