#!/usr/bin/env node
// fake-acp-agent.mjs — test fixture: a minimal stdio JSON-RPC "ACP agent".
// Logs every client message (one JSON per line) to $FAKE_ACP_LOG so tests can
// assert on what the probe actually sent (permission outcome, cancel shape).
// Env:
//   FAKE_ACP_LOG      (required) file to append client messages to
//   FAKE_ACP_OPTIONS  comma-separated permission option kinds,
//                     default "allow_once,reject_once"
//   FAKE_ACP_DIE=1    exit immediately (agent crash scenario)
import { createInterface } from 'node:readline';
import { appendFileSync } from 'node:fs';

const LOG = process.env.FAKE_ACP_LOG;
if (!LOG) { console.error('FAKE_ACP_LOG required'); process.exit(2); }
if (process.env.FAKE_ACP_DIE === '1') process.exit(1);
const OPTION_KINDS = (process.env.FAKE_ACP_OPTIONS ?? 'allow_once,reject_once').split(',').filter(Boolean);

const record = obj => appendFileSync(LOG, JSON.stringify(obj) + '\n');
const send = msg => process.stdout.write(JSON.stringify(msg) + '\n');
const pendingServer = new Map();
let serverId = 1000;

const rl = createInterface({ input: process.stdin });
rl.on('line', line => {
  let msg; try { msg = JSON.parse(line); } catch { return; }
  record(msg); // log raw client message verbatim
  // Responses to server-initiated requests (e.g. our request_permission)
  if (msg.id !== undefined && (msg.result !== undefined || msg.error !== undefined) && !msg.method) {
    const p = pendingServer.get(msg.id);
    if (p) { pendingServer.delete(msg.id); p(msg); }
    return;
  }
  if (!msg.method) return;
  const id = msg.id;
  switch (msg.method) {
    case 'initialize':
      send({ jsonrpc: '2.0', id, result: { protocolVersion: 1, agentInfo: { name: 'fake-acp', title: 'Fake ACP', version: '0.0.1' }, authMethods: [] } });
      break;
    case 'session/new':
      send({ jsonrpc: '2.0', id, result: { sessionId: 'fake-session-1' } });
      break;
    case 'session/prompt': {
      const sid = msg.params.sessionId;
      send({ jsonrpc: '2.0', method: 'session/update', params: { sessionId: sid, update: { sessionUpdate: 'agent_message_chunk', content: { type: 'text', text: 'FAKE_OK' } } } });
      const reqId = serverId++;
      const options = OPTION_KINDS.map((kind, i) => ({ optionId: `opt-${i}`, name: kind, kind }));
      send({ jsonrpc: '2.0', id: reqId, method: 'session/request_permission', params: { sessionId: sid, toolCall: { toolCallId: 'tc1', title: 'run ls' }, options } });
      pendingServer.set(reqId, () => {
        send({ jsonrpc: '2.0', id, result: { stopReason: 'end_turn' } });
      });
      break;
    }
    case 'session/cancel':
      // notification — must NOT reply
      break;
    default:
      if (id !== undefined) send({ jsonrpc: '2.0', id, error: { code: -32601, message: `Method not found: ${msg.method}` } });
  }
});
