import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeDiagnostics } from '../src/features/settings/diagnostics.ts';

function report() {
  return {
    configurationReadable: true,
    preferencesReadable: true,
    processLogsReadable: true,
    coreState: 'ready',
    coreError: null,
    snapshotError: null,
    networks: [{ state: 'running', error: null, interfaceExpected: true, interfacePresent: true }],
    recentErrors: [{ time: 1, code: 'core_exited' }],
  };
}
const status = (result, id) => result.checks.find((check) => check.id === id).status;

test('historical failures and absent peers do not make a healthy local runtime fail', () => {
  const value = report();
  value.networks[0].peerCount = 0;
  const result = summarizeDiagnostics(value);
  assert.equal(result.summary, 'healthy');
  assert.deepEqual(result.problems, []);
});

test('an intentionally stopped client is idle, including configured but stopped networks', () => {
  const value = report();
  value.coreState = 'stopped';
  value.networks[0] = { state: 'stopped', error: null };
  const result = summarizeDiagnostics(value);
  assert.equal(result.summary, 'idle');
  assert.equal(status(result, 'tun'), 'inactive');
  assert.equal(status(result, 'core'), 'inactive');
  value.networks = [];
  assert.equal(summarizeDiagnostics(value).summary, 'idle');
});

test('an unknown interface probe is incomplete, while a missing required interface is an error', () => {
  const value = report();
  value.networks[0].interfacePresent = null;
  let result = summarizeDiagnostics(value);
  assert.equal(result.summary, 'incomplete');
  assert.equal(result.errorCount, 0);
  assert.equal(status(result, 'tun'), 'unknown');
  value.networks[0].interfacePresent = false;
  result = summarizeDiagnostics(value);
  assert.equal(result.summary, 'issues');
  assert.equal(result.errorCount, 1);
  assert.equal(status(result, 'tun'), 'error');
});

test('TUN-disabled networks require no interface; unknown requirements stay unknown', () => {
  const value = report();
  value.networks[0].interfaceExpected = false;
  value.networks[0].interfacePresent = null;
  let result = summarizeDiagnostics(value);
  assert.equal(result.summary, 'healthy');
  assert.equal(status(result, 'tun'), 'inactive');
  value.networks[0].interfaceExpected = null;
  assert.equal(status(summarizeDiagnostics(value), 'tun'), 'unknown');
});

test('a confirmed missing interface is still actionable when another interface is unknown', () => {
  const value = report();
  value.networks[0].interfacePresent = null;
  value.networks.push({ ...value.networks[0], interfacePresent: false });
  const result = summarizeDiagnostics(value);
  assert.equal(status(result, 'tun'), 'error');
  assert.equal(result.errorCount, 1);
});

test('unavailable snapshots cannot be interpreted as no networks or no required interfaces', () => {
  const value = report();
  value.networks = [];
  value.snapshotError = 'request_timeout';
  const result = summarizeDiagnostics(value);
  assert.equal(result.summary, 'incomplete');
  assert.equal(status(result, 'core'), 'unknown');
  assert.equal(status(result, 'networks'), 'unknown');
  assert.equal(status(result, 'tun'), 'unknown');
});

test('starting and stopping are transitional; independent config failures remain actionable', () => {
  for (const state of ['starting', 'stopping']) {
    const value = report();
    value.networks[0] = { state, error: 'core_exited' };
    value.coreState = 'starting';
    let result = summarizeDiagnostics(value);
    assert.equal(result.summary, 'pending');
    assert.equal(result.errorCount, 0);
    value.configurationReadable = false;
    result = summarizeDiagnostics(value);
    assert.equal(result.summary, 'issues');
    assert.equal(result.errorCount, 1);
  }
});

test('partial logs do not claim the runtime failed; failed states need no error code', () => {
  const value = report();
  value.processLogsReadable = false;
  let result = summarizeDiagnostics(value);
  assert.equal(result.summary, 'incomplete');
  assert.equal(result.errorCount, 0);
  assert.deepEqual(result.problems, [{ id: 'logs', status: 'unknown' }]);
  value.coreState = 'failed';
  value.networks[0] = { state: 'failed', error: null };
  result = summarizeDiagnostics(value);
  assert.equal(status(result, 'core'), 'error');
  assert.equal(status(result, 'networks'), 'error');
  assert.equal(result.errorCount, 2);
});
