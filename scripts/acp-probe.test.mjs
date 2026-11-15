// acp-probe.test.mjs — regression tests for the ACP probe's security policy
// and protocol correctness. Run: node --test scripts/
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { readFileSync, mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { choosePermissionOutcome, insideRoot } from './acp-probe.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PROBE = join(HERE, 'acp-probe.mjs');
const FAKE = join(HERE, 'fake-acp-agent.mjs');
const ALLOW_ROOT = mkdtempSync(join(tmpdir(), 'acp-probe-root-'));
const INSIDE = join(ALLOW_ROOT, 'proj');
mkdirSync(INSIDE, { recursive: true });
const OUTSIDE = mkdtempSync(join(tmpdir(), 'acp-probe-outside-'));

function runProbe({ cwd = INSIDE, extra = [], env = {} } = {}) {
  return new Promise(resolve => {
    const log = join(ALLOW_ROOT, `fake-${Date.now()}-${Math.random().toString(36).slice(2)}.log`);
    const child = spawn('node', [PROBE, '--cmd', `node ${FAKE}`, '--cwd', cwd,
      '--allow-root', ALLOW_ROOT, '--timeout', '15000', ...extra], {
      env: { ...process.env, FAKE_ACP_LOG: log, ...env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let out = '', err = '';
    child.stdout.on('data', d => out += d);
    child.stderr.on('data', d => err += d);
    child.on('close', code => {
      let verdict = null;
      try { verdict = JSON.parse(out); } catch {}
      let sent = [];
      try { sent = readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse); } catch {}
      resolve({ code, verdict, sent, err });
    });
  });
}

// ---------- pure-function tests ----------

test('permission denied by default: picks reject_once', () => {
  const r = choosePermissionOutcome({ options: [
    { optionId: 'a', kind: 'allow_once' },
    { optionId: 'b', kind: 'reject_once' },
  ] });
  assert.equal(r.outcome.outcome, 'selected');
  assert.equal(r.outcome.optionId, 'b');
});

test('permission denied: cancel outcome when no reject option', () => {
  const r = choosePermissionOutcome({ options: [{ optionId: 'a', kind: 'allow_once' }] });
  assert.deepEqual(r, { outcome: { outcome: 'cancelled' } });
});

test('autoApprove picks allow_once', () => {
  const r = choosePermissionOutcome({ options: [
    { optionId: 'a', kind: 'allow_once' }, { optionId: 'b', kind: 'reject_once' },
  ] }, { autoApprove: true });
  assert.equal(r.outcome.optionId, 'a');
});

test('autoApprove never fabricates approval without allow_once', () => {
  const r = choosePermissionOutcome({ options: [{ optionId: 'b', kind: 'reject_once' }] }, { autoApprove: true });
  assert.equal(r.outcome.optionId, 'b');
});

test('insideRoot containment', () => {
  assert.equal(insideRoot(INSIDE, ALLOW_ROOT), true);
  assert.equal(insideRoot(OUTSIDE, ALLOW_ROOT), false);
  assert.equal(insideRoot(ALLOW_ROOT, ALLOW_ROOT), true);
});

// ---------- end-to-end probe tests ----------

test('e2e: deny-by-default, cancel is a notification, PASS exits 0', async () => {
  const { code, verdict, sent } = await runProbe();
  assert.equal(code, 0, `expected exit 0, got ${code}; verdict=${JSON.stringify(verdict)}`);
  assert.equal(verdict.result, 'PASS');
  assert.equal(verdict.permissionRequests, 1);
  assert.equal(verdict.permissionOutcome, 'reject_once');
  // session/cancel must be sent WITHOUT an id (notification)
  const cancel = sent.find(m => m.method === 'session/cancel');
  assert.ok(cancel, 'session/cancel was sent');
  assert.equal(cancel.id, undefined, 'cancel must not carry an id');
  // and the permission reply must not select allow_once
  const permReply = sent.find(m => m.id !== undefined && m.result?.outcome);
  assert.notEqual(permReply.result.outcome.optionId, 'opt-0');
});

test('e2e: cancelled outcome when agent offers only allow options', async () => {
  const { code, verdict } = await runProbe({ env: { FAKE_ACP_OPTIONS: 'allow_once,allow_always' } });
  assert.equal(code, 0);
  assert.equal(verdict.permissionOutcome, 'cancelled');
});

test('e2e: --auto-approve inside allow-root approves', async () => {
  const { code, verdict } = await runProbe({ extra: ['--auto-approve'] });
  assert.equal(code, 0);
  assert.equal(verdict.permissionOutcome, 'allow_once');
});

test('e2e: --auto-approve outside allow-root is still denied', async () => {
  const { code, verdict } = await runProbe({ cwd: OUTSIDE, extra: ['--auto-approve'] });
  assert.equal(code, 0);
  assert.ok(verdict.autoApproveBlocked, 'block reason recorded');
  assert.equal(verdict.permissionOutcome, 'reject_once');
});

test('e2e: agent crash -> FAIL -> exit 1', async () => {
  const { code, verdict } = await runProbe({ env: { FAKE_ACP_DIE: '1' } });
  assert.equal(code, 1);
  assert.equal(verdict.result, 'FAIL');
});
