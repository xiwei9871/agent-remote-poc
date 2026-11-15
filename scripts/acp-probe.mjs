#!/usr/bin/env node
// acp-probe.mjs — minimal ACP (Agent Client Protocol) compatibility probe.
// Speaks JSON-RPC 2.0 over stdio (NDJSON) with an agent process:
//   initialize -> [authenticate] -> session/new -> session/prompt -> session/cancel
// Usage:
//   node acp-probe.mjs --cmd "<spawn command>" [--cwd <dir>] [--prompt "text"]
//   node acp-probe.mjs --cmd "/path/to/devin acp" --cwd /some/project
//   node acp-probe.mjs --cmd "claude-agent-acp" --timeout 120000
// Prints a JSON verdict line at the end; full event log to stderr unless -q.
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}
const CMD = arg('cmd', '');
const CWD = arg('cwd', process.cwd());
const PROMPT = arg('prompt', 'Reply with exactly: ACP_OK');
const TIMEOUT = parseInt(arg('timeout', '90000'), 10);
const VERBOSE = process.argv.includes('-v');
if (!CMD) { console.error('missing --cmd'); process.exit(2); }

const verdict = { cmd: CMD, cwd: CWD, steps: {}, updates: 0, text: '', cancelOk: null };
const log = (...a) => VERBOSE && console.error('[probe]', ...a);

const child = spawn('sh', ['-c', CMD], { cwd: CWD, stdio: ['pipe', 'pipe', 'pipe'] });
child.stderr.on('data', d => VERBOSE && process.stderr.write('[agent-stderr] ' + d));
child.on('exit', (code, sig) => { verdict.childExit = { code, sig }; });

const rl = createInterface({ input: child.stdout });
let nextId = 1;
const pending = new Map();
const sessionUpdates = [];

rl.on('line', line => {
  if (!line.trim()) return;
  let msg; try { msg = JSON.parse(line); } catch { log('non-json:', line.slice(0, 200)); return; }
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
    const p = pending.get(msg.id);
    if (p) { pending.delete(msg.id); msg.error ? p.rej(msg.error) : p.res(msg.result); }
    return;
  }
  if (msg.method) {
    log('notify', msg.method, JSON.stringify(msg.params).slice(0, 300));
    if (msg.method === 'session/update') {
      verdict.updates++;
      sessionUpdates.push(msg.params);
      const u = msg.params?.update;
      const chunk = u?.content?.text ?? (u?.sessionUpdate === 'agent_message_chunk' ? u?.content?.text : undefined);
      if (u?.sessionUpdate === 'agent_message_chunk' && u?.content?.type === 'text') verdict.text += u.content.text;
      // agent-side requests (permission etc.) arrive with an id we must answer
    }
    if (msg.id !== undefined) {
      // It's a request FROM the agent (e.g. session/request_permission, fs/read_text_file)
      const deny = { jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'probe does not implement client methods' } };
      if (msg.method === 'session/request_permission') {
        const opt = msg.params?.options?.find(o => o.kind === 'allow_once') ?? msg.params?.options?.[0];
        child.stdin.write(JSON.stringify({ jsonrpc: '2.0', id: msg.id, result: { outcome: { outcome: 'selected', optionId: opt?.optionId } } }) + '\n');
        verdict.permissionRequests = (verdict.permissionRequests ?? 0) + 1;
      } else {
        child.stdin.write(JSON.stringify(deny) + '\n');
        verdict.clientMethodCalls = (verdict.clientMethodCalls ?? 0) + 1;
        (verdict.clientMethodsSeen ??= []).push(msg.method);
      }
    }
  }
});

function rpc(method, params, ms = TIMEOUT) {
  const id = nextId++;
  const msg = { jsonrpc: '2.0', id, method, params };
  child.stdin.write(JSON.stringify(msg) + '\n');
  log('send', method);
  return new Promise((res, rej) => {
    pending.set(id, { res, rej });
    setTimeout(() => { if (pending.delete(id)) rej(new Error(`${method} timed out`)); }, ms);
  });
}

const done = code => { verdict.result = code; console.log(JSON.stringify(verdict, null, 2)); try { child.kill('SIGTERM'); } catch {} setTimeout(() => process.exit(0), 500); };

(async () => {
  try {
    const init = await rpc('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'acp-probe', version: '0.1.0' },
    });
    verdict.steps.initialize = { ok: true, agentInfo: init?.agentInfo, protocolVersion: init?.protocolVersion, authMethods: init?.authMethods };

    if (init?.authMethods?.length) {
      try { await rpc('authenticate', { methodId: init.authMethods[0].id }, 15000); verdict.steps.authenticate = { ok: true }; }
      catch (e) { verdict.steps.authenticate = { ok: false, error: String(e) }; }
    }

    const sess = await rpc('session/new', { cwd: CWD, mcpServers: [] });
    verdict.steps.sessionNew = { ok: true, sessionId: sess?.sessionId, models: sess?.models ? 'present' : 'absent' };
    const sid = sess?.sessionId;

    // Fire prompt; end turn either via response or timeout.
    const promptP = rpc('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: PROMPT }] }, TIMEOUT);
    const promptRes = await promptP.catch(e => ({ error: String(e) }));
    verdict.steps.sessionPrompt = { ok: !promptRes?.error, stopReason: promptRes?.stopReason, error: promptRes?.error };

    try { await rpc('session/cancel', { sessionId: sid }, 10000); verdict.cancelOk = true; }
    catch { verdict.cancelOk = false; }
    done(promptRes?.error ? 'FAIL' : 'PASS');
  } catch (e) {
    verdict.steps.lastError = String(e);
    done('FAIL');
  }
})();
