#!/usr/bin/env node
// acp-probe.mjs — minimal ACP (Agent Client Protocol) compatibility probe.
// Speaks JSON-RPC 2.0 over stdio (NDJSON) with an agent process:
//   initialize -> [authenticate] -> session/new -> session/prompt -> session/cancel(notification)
//
// Security policy: `session/request_permission` is DENIED by default
// (reject_* option when offered, else outcome "cancelled"). Auto-approval is
// only possible with `--auto-approve` AND a --cwd inside --allow-root
// (default: ~/agent-hub-poc). There is no way to auto-approve outside the
// isolated test root.
//
// Exit code: 0 = PASS, 1 = FAIL, 2 = usage error.
//
// Usage:
//   node acp-probe.mjs --cmd "<spawn command>" [--cwd <dir>] [--prompt "text"]
//   node acp-probe.mjs --cmd "claude-agent-acp" --cwd /path -v
//   node acp-probe.mjs --cmd "..." --auto-approve --allow-root ~/agent-hub-poc
import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import { realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve, sep } from 'node:path';
import { pathToFileURL } from 'node:url';

/** Decide the outcome for a session/request_permission call.
 *  Policy: deny by default; auto-approve only when explicitly enabled.
 *  Returns {outcome:{outcome:'selected',optionId}} | {outcome:{outcome:'cancelled'}}. */
export function choosePermissionOutcome(params, { autoApprove = false } = {}) {
  const options = params?.options ?? [];
  const byKind = kind => options.find(o => o.kind === kind);
  if (autoApprove) {
    const allow = byKind('allow_once');
    if (allow) return { outcome: { outcome: 'selected', optionId: allow.optionId } };
    // No allow_once: never fabricate approval.
  }
  const deny = byKind('reject_once') ?? byKind('reject_always');
  if (deny) return { outcome: { outcome: 'selected', optionId: deny.optionId } };
  return { outcome: { outcome: 'cancelled' } };
}

/** True when `cwd` resolves inside `root` (symlinks resolved). */
export function insideRoot(cwd, root) {
  try {
    const r = realpathSync(resolve(root));
    const c = realpathSync(resolve(cwd));
    return c === r || c.startsWith(r + sep);
  } catch {
    return false;
  }
}

function arg(name, dflt) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : dflt;
}

export async function run({ cmd, cwd, prompt, timeout, autoApprove, allowRoot, verbose }) {
  const verdict = { cmd, cwd, steps: {}, updates: 0, text: '', cancelMode: 'notification' };
  const log = (...a) => verbose && console.error('[probe]', ...a);
  const approveAllowed = autoApprove && insideRoot(cwd, allowRoot);
  if (autoApprove && !approveAllowed) verdict.autoApproveBlocked = `cwd ${cwd} is outside ${allowRoot}`;

  const child = spawn('sh', ['-c', cmd], { cwd, stdio: ['pipe', 'pipe', 'pipe'] });
  child.stderr.on('data', d => verbose && process.stderr.write('[agent-stderr] ' + d));
  child.on('exit', (code, sig) => { verdict.childExit = { code, sig }; });

  const rl = createInterface({ input: child.stdout });
  let nextId = 1;
  const pending = new Map();
  const send = msg => child.stdin.write(JSON.stringify(msg) + '\n');

  rl.on('line', line => {
    if (!line.trim()) return;
    let msg; try { msg = JSON.parse(line); } catch { log('non-json:', line.slice(0, 200)); return; }
    if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined)) {
      const p = pending.get(msg.id);
      if (p) { pending.delete(msg.id); msg.error ? p.rej(msg.error) : p.res(msg.result); }
      return;
    }
    if (!msg.method) return;
    log('notify', msg.method, JSON.stringify(msg.params).slice(0, 300));
    if (msg.method === 'session/update') {
      verdict.updates++;
      const u = msg.params?.update;
      if (u?.sessionUpdate === 'agent_message_chunk' && u?.content?.type === 'text') verdict.text += u.content.text;
    }
    if (msg.id !== undefined) {
      // Request FROM the agent.
      if (msg.method === 'session/request_permission') {
        const result = choosePermissionOutcome(msg.params, { autoApprove: approveAllowed });
        verdict.permissionRequests = (verdict.permissionRequests ?? 0) + 1;
        verdict.permissionOutcome = result.outcome.outcome === 'cancelled' ? 'cancelled'
          : (msg.params?.options?.find(o => o.optionId === result.outcome.optionId)?.kind ?? 'selected');
        send({ jsonrpc: '2.0', id: msg.id, result });
      } else {
        send({ jsonrpc: '2.0', id: msg.id, error: { code: -32601, message: 'probe does not implement client methods' } });
        verdict.clientMethodCalls = (verdict.clientMethodCalls ?? 0) + 1;
        (verdict.clientMethodsSeen ??= []).push(msg.method);
      }
    }
  });

  const rpc = (method, params, ms = timeout) => {
    const id = nextId++;
    send({ jsonrpc: '2.0', id, method, params });
    log('send', method);
    return new Promise((res, rej) => {
      pending.set(id, { res, rej });
      setTimeout(() => { if (pending.delete(id)) rej(new Error(`${method} timed out`)); }, ms);
    });
  };
  // ACP session/cancel is a *notification*: no id, no response expected.
  const cancel = sessionId => { send({ jsonrpc: '2.0', method: 'session/cancel', params: { sessionId } }); log('notify-out session/cancel'); };

  const finish = code => {
    verdict.result = code;
    console.log(JSON.stringify(verdict, null, 2));
    try { child.kill('SIGTERM'); } catch {}
    return code === 'PASS' ? 0 : 1;
  };

  try {
    const init = await rpc('initialize', {
      protocolVersion: 1,
      clientCapabilities: { fs: { readTextFile: false, writeTextFile: false }, terminal: false },
      clientInfo: { name: 'acp-probe', version: '0.2.0' },
    });
    verdict.steps.initialize = { ok: true, agentInfo: init?.agentInfo, protocolVersion: init?.protocolVersion, authMethods: init?.authMethods };

    if (init?.authMethods?.length) {
      try { await rpc('authenticate', { methodId: init.authMethods[0].id }, 15000); verdict.steps.authenticate = { ok: true }; }
      catch (e) { verdict.steps.authenticate = { ok: false, error: String(e) }; }
    }

    const sess = await rpc('session/new', { cwd, mcpServers: [] });
    verdict.steps.sessionNew = { ok: true, sessionId: sess?.sessionId, models: sess?.models ? 'present' : 'absent' };
    const sid = sess?.sessionId;

    const promptRes = await rpc('session/prompt', { sessionId: sid, prompt: [{ type: 'text', text: prompt }] }, timeout)
      .catch(e => ({ error: String(e) }));
    verdict.steps.sessionPrompt = { ok: !promptRes?.error, stopReason: promptRes?.stopReason, error: promptRes?.error };

    cancel(sid);
    return finish(promptRes?.error ? 'FAIL' : 'PASS');
  } catch (e) {
    verdict.steps.lastError = String(e);
    return finish('FAIL');
  }
}

const invoked = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (invoked) {
  const cmd = arg('cmd', '');
  if (!cmd) { console.error('missing --cmd'); process.exit(2); }
  const code = await run({
    cmd,
    cwd: arg('cwd', process.cwd()),
    prompt: arg('prompt', 'Reply with exactly: ACP_OK'),
    timeout: parseInt(arg('timeout', '90000'), 10),
    autoApprove: process.argv.includes('--auto-approve'),
    allowRoot: arg('allow-root', `${homedir()}/agent-hub-poc`),
    verbose: process.argv.includes('-v'),
  });
  process.exit(code);
}
