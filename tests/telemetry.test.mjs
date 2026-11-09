import assert from 'node:assert/strict';
import test from 'node:test';
import { createTelemetryStore } from '../src/features/networks/telemetry.ts';
import { trafficChart } from '../src/features/dashboard/traffic-chart.ts';
import { fixture as workflowFixture, idle, profile } from './helpers/networks.mjs';

const sample = (elapsedMs, downloadBytes, uploadBytes = '0', session = 'session-a') => ({
  session,
  elapsedMs,
  downloadBytes: String(downloadBytes),
  uploadBytes: String(uploadBytes),
  hostname: 'actual-node',
  peers: [{ id: '2', name: 'friend', ip: null, connection: 'direct', latency: 12, lossRate: 0 }],
  incomplete: false,
});
function fixture() {
  let time = 0;
  const telemetry = createTelemetryStore(() => time);
  return {
    telemetry,
    at: (value) => {
      time = value;
    },
    get: (id = 'a') => telemetry.store.getState()[id]?.traffic,
    devices: (id = 'a') => telemetry.store.getState()[id]?.devices,
  };
}
test('rates use elapsed time and exact integer differences, including above JS safe integer range', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, '9007199254740993'), 'running');
  assert.equal(f.get().download, null);
  f.at(1000);
  f.telemetry.receive('a', sample(1000, '9007199254742017', '2048'), 'running');
  assert.equal(f.get().download, 1024);
  assert.equal(f.get().upload, 2048);
  f.at(2000);
  f.telemetry.receive('a', sample(2000, '9007199254742017', '2048'), 'running');
  assert.equal(f.get().download, 0);
});
test('query failure retains devices and totals but blanks measurements and splits chart history', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 10), 'running');
  f.at(1000);
  f.telemetry.receive('a', sample(1000, 1034), 'running');
  f.at(2000);
  f.telemetry.stale('a');
  assert.equal(f.get().freshness, 'stale');
  assert.equal(f.get().download, null);
  assert.equal(f.devices().peers.length, 1);
  assert.equal(f.get().snapshot.downloadBytes, '1034');
  f.at(3000);
  f.telemetry.receive('a', sample(3000, 3082), 'running');
  assert.equal(f.get().download, null);
  f.at(4000);
  f.telemetry.receive('a', sample(4000, 4106), 'running');
  assert.equal(f.get().download, 1024);
  assert.equal(trafficChart(f.get().points).download.length, 2);
});
test('expired reads blank rates even while a query is still pending; long gaps are never averaged into realtime rates', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  f.at(1000);
  f.telemetry.receive('a', sample(1000, 1024), 'running');
  f.at(4000);
  f.telemetry.expire();
  assert.equal(f.get().freshness, 'stale');
  f.at(8000);
  f.telemetry.receive('a', sample(8000, 8192), 'running');
  assert.equal(f.get().download, null);
  assert.equal(f.get().snapshot.downloadBytes, '8192');
});
test('stop retains totals; only a new session resets history, independently of other networks', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 128), 'running');
  f.telemetry.receive('b', sample(0, 256, '0', 'session-b'), 'running');
  f.telemetry.receive('a', null, 'stopped');
  assert.equal(f.get().snapshot.downloadBytes, '128');
  assert.equal(f.get().freshness, 'stopped');
  f.at(1000);
  f.telemetry.receive('a', sample(0, 5, '0', 'new-session'), 'running');
  assert.equal(f.get().snapshot.downloadBytes, '5');
  assert.equal(f.get().points.length, 1);
  assert.equal(f.get('b').snapshot.downloadBytes, '256');
});
test('old snapshots and duplicate focus refreshes cannot regress counters or erase a valid rate', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  f.at(1000);
  f.telemetry.receive('a', sample(1000, 1024), 'running');
  f.telemetry.receive('a', sample(500, 512), 'running');
  assert.equal(f.get().snapshot.downloadBytes, '1024');
  f.telemetry.receive('a', sample(1000, 1024), 'running');
  assert.equal(f.get().download, 1024);
  assert.equal(f.get().points.length, 2);
});
test('time window stays bounded and zero-only charts contain no NaN or division by zero', () => {
  const f = fixture();
  for (let time = 0; time <= 120_000; time += 1000) {
    f.at(time);
    f.telemetry.receive('a', sample(time, 0), 'running');
  }
  assert.equal(f.get().points.length, 61);
  const chart = trafficChart(f.get().points);
  assert.equal(chart.scale, 1024);
  assert.ok(!chart.download.join('').includes('NaN'));
  assert.ok(chart.download[0].includes('600.0,136.0'));
});
test('both directions share a chart scale and irregular samples use actual time coordinates', () => {
  const chart = trafficChart([
    { at: 0, download: 1024, upload: 4096 },
    { at: 10000, download: 0, upload: null },
  ]);
  assert.equal(chart.scale, 4096);
  assert.equal(chart.download[0], 'M500.0,105.0 L600.0,136.0');
});
test('byte-only samples never notify configuration or connection subscribers', async () => {
  const f = fixture();
  const network = profile('a', 'a');
  const workflow = workflowFixture([network]);
  const store = workflow.makeStore({ telemetry: f.telemetry });
  workflow.put({
    id: 'a',
    state: 'running',
    runningConfig: network.savedConfig,
    deviceName: 'ct-test',
    virtualIp: '10.42.0.2',
    peerCount: 1,
    directPeerCount: 1,
    telemetry: sample(0, 0),
  });
  await store.getState().initialize();
  let notifications = 0;
  store.subscribe(() => {
    notifications++;
  });
  for (let bytes = 1000; bytes <= 5000; bytes += 1000) {
    f.at(bytes);
    workflow.put({ ...workflow.frame().networks[0], telemetry: sample(bytes, bytes) });
    await store.getState().refreshRuntime();
  }
  assert.equal(notifications, 0);
  assert.equal(f.get().download, 1000);
  workflow.control.failRead = { code: 'request_timeout' };
  await store.getState().refreshRuntime();
  assert.equal(f.get().freshness, 'stale');
  assert.equal(store.getState().networks[0].coreState, 'unknown');
});
test('unchanged cached samples cannot renew freshness, including after a stale interval', () => {
  const f = fixture();
  const value = sample(0, 10);
  f.telemetry.receive('a', value, 'running');
  for (let at = 1000; at <= 5000; at += 1000) {
    f.at(at);
    f.telemetry.receive('a', value, 'running');
    f.telemetry.expire();
  }
  assert.equal(f.get().updatedAt, 0);
  assert.equal(f.get().freshness, 'stale');
  assert.equal(f.get().points.length, 2);
});

test('gradient areas close inside each measured interval and never bridge a missing sample', () => {
  const chart = trafficChart([
    { at: 0, download: 1024, upload: 512 },
    { at: 1000, download: 2048, upload: null },
    { at: 2000, download: null, upload: null },
    { at: 3000, download: 1024, upload: null },
    { at: 4000, download: 1024, upload: 512 },
  ]);
  assert.equal(chart.areas.download.length, 2);
  assert.match(chart.areas.download[0], /^M560\.0,.* L570\.0,136\.0 L560\.0,136\.0 Z$/);
  assert.match(chart.areas.download[1], /^M590\.0,.* L600\.0,136\.0 L590\.0,136\.0 Z$/);
  assert.deepEqual(chart.areas.upload, [], 'isolated samples cannot invent a filled interval');
  assert.deepEqual(chart.axis, { unit: 'KiB/s', ticks: ['2', '1', '0'] });
  assert.deepEqual(trafficChart([]).axis, { unit: 'KiB/s', ticks: ['1', '0.5', '0'] });
});

test('traffic changes every sample while unchanged device read models preserve their references', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  const devices = f.devices();
  const peer = devices.peers[0];
  let traffic = f.get();
  for (let at = 1000; at <= 10_000; at += 1000) {
    f.at(at);
    f.telemetry.receive('a', sample(at, at), 'running');
    assert.notEqual(f.get(), traffic);
    assert.equal(f.devices(), devices);
    assert.equal(f.devices().peers[0], peer);
    traffic = f.get();
  }
});

test('quality publishes the latest values every three seconds, independently of receipt freshness', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  const before = f.devices();
  for (let at = 1000; at <= 2000; at += 1000) {
    f.at(at);
    const next = sample(at, at);
    next.peers[0].latency = at / 100;
    next.peers[0].lossRate = at / 100_000;
    f.telemetry.receive('a', next, 'running');
    f.telemetry.expire();
    assert.equal(f.devices(), before);
    assert.equal(f.get().freshness, 'fresh');
  }
  f.at(3000);
  const next = sample(3000, 3000);
  next.peers[0].latency = 30;
  next.peers[0].lossRate = 0.03;
  f.telemetry.receive('a', next, 'running');
  assert.equal(f.devices().peers[0].latency, 30);
  assert.equal(f.devices().peers[0].lossRate, 0.03);
});

test('structure changes publish immediately without flushing unrelated pending metrics', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  f.at(1000);
  const next = sample(1000, 1000);
  next.peers[0] = {
    ...next.peers[0],
    name: 'renamed',
    ip: '10.1.1.3',
    latency: 99,
    version: 'next',
    protocols: ['UDP'],
  };
  next.peers.push({ id: 'new', name: 'joined', ip: null, connection: 'direct', latency: 33 });
  f.telemetry.receive('a', next, 'running');
  assert.equal(f.devices().peers.length, 2);
  assert.equal(f.devices().peers[0].name, 'renamed');
  assert.equal(f.devices().peers[0].version, 'next');
  assert.deepEqual(f.devices().peers[0].protocols, ['UDP']);
  assert.equal(f.devices().peers[0].latency, 12);
  assert.equal(f.devices().peers[1].latency, 33);
  f.at(2000);
  const removed = structuredClone(next);
  removed.elapsedMs = 2000;
  removed.peers.shift();
  const retained = f.devices().peers[1];
  f.telemetry.receive('a', removed, 'running');
  assert.equal(f.devices().peers.length, 1);
  assert.equal(f.devices().peers[0], retained);
});

test('relay changes, unavailable measurements and stale data clear invalid quality immediately', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  f.at(1000);
  const relay = sample(1000, 1000);
  relay.peers[0] = {
    ...relay.peers[0],
    connection: 'relay',
    nextHop: 'gateway',
    latency: 100,
    lossRate: 0.1,
  };
  f.telemetry.receive('a', relay, 'running');
  assert.equal(f.devices().peers[0].latency, null);
  assert.equal(f.devices().peers[0].lossRate, null);
  assert.equal(f.devices().peers[0].nextHop, 'gateway');
  f.at(1500);
  f.telemetry.receive('a', sample(1500, 1500), 'running');
  assert.equal(f.devices().peers[0].latency, 12);
  f.at(2000);
  const unavailable = sample(2000, 2000);
  unavailable.peers[0].latency = null;
  unavailable.peers[0].lossRate = null;
  f.telemetry.receive('a', unavailable, 'running');
  assert.equal(f.devices().peers[0].latency, null);
  f.at(5000);
  f.telemetry.expire();
  assert.equal(f.devices().freshness, 'stale');
  assert.equal(f.devices().peers.length, 1);
  f.at(6000);
  f.telemetry.receive('a', sample(6000, 6000), 'running');
  assert.equal(f.devices().peers[0].latency, 12);
});

test('stopping clears peers immediately, and a new session cannot reuse old metrics or totals', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 100), 'running');
  f.telemetry.receive('a', sample(0, 100), 'stopped');
  assert.deepEqual(f.devices().peers, []);
  f.at(1000);
  const next = sample(0, 1, 0, 'new');
  next.peers[0].latency = 50;
  f.telemetry.receive('a', next, 'running');
  assert.equal(f.devices().peers[0].latency, 50);
  assert.equal(f.get().snapshot.downloadBytes, '1');
  assert.equal(f.get().download, null);
  assert.equal(f.get().points.length, 1);
});

test('hidden views stop publishing and restore latest observations without averaging across the gap', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  f.at(1000);
  f.telemetry.receive('a', sample(1000, 1000), 'running');
  const visible = f.telemetry.store.getState();
  let notifications = 0;
  f.telemetry.store.subscribe(() => notifications++);
  f.telemetry.setVisible(false);
  for (let at = 2000; at <= 20_000; at += 1000) {
    f.at(at);
    const next = sample(at, at);
    next.peers[0].latency = at;
    f.telemetry.receive('a', next, 'running');
    f.telemetry.expire();
  }
  assert.equal(f.telemetry.store.getState(), visible);
  assert.equal(notifications, 0);
  f.telemetry.setVisible(true);
  assert.equal(notifications, 1);
  assert.equal(f.get().snapshot.downloadBytes, '20000');
  assert.equal(f.devices().peers[0].latency, 20_000);
  assert.equal(f.get().download, null);
  assert.equal(f.get().points.length, 3, 'hidden samples must not fabricate chart history');
  f.at(21_000);
  f.telemetry.receive('a', sample(21_000, 21_000), 'running');
  assert.equal(f.get().download, null, 'the first visible sample rebuilds the baseline');
  f.at(22_000);
  f.telemetry.receive('a', sample(22_000, 22_000), 'running');
  assert.equal(f.get().download, 1000);
  assert.equal(
    trafficChart(f.get().points).download.length,
    2,
    'isolated intervals cannot bridge the hidden gap',
  );
});

test('resume does not renew old cached data; hidden stops, removals and session changes remain independent', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 100), 'running');
  f.telemetry.receive('b', sample(0, 200, 0, 'b'), 'running');
  f.telemetry.receive('c', sample(0, 300, 0, 'c'), 'running');
  f.telemetry.receive('d', sample(0, 400, 0, 'd'), 'running');
  f.telemetry.setVisible(false);
  f.at(1000);
  f.telemetry.receive('b', null, 'stopped');
  f.telemetry.receive('d', null, 'stopped');
  f.telemetry.receive('c', sample(0, 1, 0, 'new-c'), 'running');
  f.telemetry.remove('b');
  f.at(5000);
  f.telemetry.setVisible(true);
  assert.equal(f.get().freshness, 'stale');
  assert.equal(f.devices().peers[0].latency, null);
  assert.equal(f.get().updatedAt, 0);
  assert.equal(f.get('b'), undefined);
  assert.equal(f.get('c').snapshot.downloadBytes, '1');
  assert.equal(f.get('c').freshness, 'stale');
  assert.equal(f.get('c').points.length, 1);
  assert.equal(f.get('d').freshness, 'stopped');
  assert.equal(f.get('d').snapshot.downloadBytes, '400');
  assert.deepEqual(f.devices('d').peers, []);
});

test('initially hidden publication does not block startup auto-connect or its state synchronization', async () => {
  const f = fixture();
  f.telemetry.setVisible(false);
  const network = profile('automatic', 'a');
  network.autoConnect = true;
  const workflow = workflowFixture([network]);
  workflow.control.health = 'initializing';
  const store = workflow.makeStore({ telemetry: f.telemetry });
  await store.getState().initialize();
  assert.equal(workflow.calls.length, 0);
  workflow.control.health = 'ready';
  await store.getState().refreshRuntime();
  await idle(store);
  assert.equal(workflow.calls.length, 1);
  assert.equal(store.getState().networks[0].coreState, 'running');
  assert.deepEqual(f.telemetry.store.getState(), {});
  f.telemetry.setVisible(true);
  assert.equal(f.get().freshness, 'fresh');
  assert.equal(f.get().download, null);
});
