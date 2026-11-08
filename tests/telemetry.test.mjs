import assert from 'node:assert/strict';
import test from 'node:test';
import { createTelemetryStore } from '../src/features/networks/telemetry.ts';
import { trafficChart } from '../src/features/dashboard/traffic-chart.ts';
import { createNetworkStore, newNetworkDraft } from '../src/features/networks/network-store.ts';

const sample = (elapsedMs, downloadBytes, uploadBytes = '0', session = 'session-a') => ({
  session, elapsedMs, downloadBytes: String(downloadBytes), uploadBytes: String(uploadBytes),
  hostname: 'actual-node', peers: [{ id: '2', name: 'friend', ip: null, connection: 'direct', latency: 12, lossRate: 0 }], incomplete: false,
});
function fixture() {
  let time = 0;
  const telemetry = createTelemetryStore(() => time);
  return { telemetry, at: (value) => { time = value; }, get: (id = 'a') => telemetry.store.getState()[id] };
}
test('rates use elapsed time and exact integer differences, including above JS safe integer range', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, '9007199254740993'), 'running');
  assert.equal(f.get().download, null);
  f.at(1000); f.telemetry.receive('a', sample(1000, '9007199254742017', '2048'), 'running');
  assert.equal(f.get().download, 1024); assert.equal(f.get().upload, 2048);
  f.at(2000); f.telemetry.receive('a', sample(2000, '9007199254742017', '2048'), 'running');
  assert.equal(f.get().download, 0);
});
test('query failure retains devices and totals but blanks measurements and splits chart history', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 10), 'running');
  f.at(1000); f.telemetry.receive('a', sample(1000, 1034), 'running');
  f.at(2000); f.telemetry.stale('a');
  assert.equal(f.get().freshness, 'stale'); assert.equal(f.get().download, null);
  assert.equal(f.get().snapshot.peers.length, 1); assert.equal(f.get().snapshot.downloadBytes, '1034');
  f.at(3000); f.telemetry.receive('a', sample(3000, 3082), 'running');
  assert.equal(f.get().download, null);
  f.at(4000); f.telemetry.receive('a', sample(4000, 4106), 'running');
  assert.equal(f.get().download, 1024);
  assert.equal(trafficChart(f.get().points).download.length, 2);
});
test('expired reads blank rates even while a query is still pending; long gaps are never averaged into realtime rates', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  f.at(1000); f.telemetry.receive('a', sample(1000, 1024), 'running');
  f.at(4000); f.telemetry.expire();
  assert.equal(f.get().freshness, 'stale');
  f.at(8000); f.telemetry.receive('a', sample(8000, 8192), 'running');
  assert.equal(f.get().download, null); assert.equal(f.get().snapshot.downloadBytes, '8192');
});
test('stop retains totals; only a new session resets history, independently of other networks', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 128), 'running');
  f.telemetry.receive('b', sample(0, 256, '0', 'session-b'), 'running');
  f.telemetry.receive('a', null, 'stopped');
  assert.equal(f.get().snapshot.downloadBytes, '128'); assert.equal(f.get().freshness, 'stopped');
  f.at(1000); f.telemetry.receive('a', sample(0, 5, '0', 'new-session'), 'running');
  assert.equal(f.get().snapshot.downloadBytes, '5'); assert.equal(f.get().points.length, 1);
  assert.equal(f.get('b').snapshot.downloadBytes, '256');
});
test('old snapshots and duplicate focus refreshes cannot regress counters or erase a valid rate', () => {
  const f = fixture();
  f.telemetry.receive('a', sample(0, 0), 'running');
  f.at(1000); f.telemetry.receive('a', sample(1000, 1024), 'running');
  f.telemetry.receive('a', sample(500, 512), 'running');
  assert.equal(f.get().snapshot.downloadBytes, '1024');
  f.telemetry.receive('a', sample(1000, 1024), 'running');
  assert.equal(f.get().download, 1024); assert.equal(f.get().points.length, 2);
});
test('time window stays bounded and zero-only charts contain no NaN or division by zero', () => {
  const f = fixture();
  for (let time = 0; time <= 120_000; time += 1000) {
    f.at(time); f.telemetry.receive('a', sample(time, 0), 'running');
  }
  assert.equal(f.get().points.length, 61);
  const chart = trafficChart(f.get().points);
  assert.equal(chart.scale, 1024); assert.ok(!chart.download.join('').includes('NaN'));
  assert.ok(chart.download[0].includes('600.0,136.0'));
});
test('both directions share a chart scale and irregular samples use actual time coordinates', () => {
  const chart = trafficChart([{ at: 0, download: 1024, upload: 4096 }, { at: 10000, download: 0, upload: null }]);
  assert.equal(chart.scale, 4096);
  assert.equal(chart.download[0], 'M500.0,105.0 L600.0,136.0');
});
test('byte-only samples never notify the configuration and connection store subscribers', async () => {
  const f = fixture(); const network = newNetworkDraft([], 'a');
  let bytes = 0;
  const runtime = Object.assign(async () => [], { snapshot: async () => [{ id: 'a', state: 'running',
    runningConfig: network.savedConfig, deviceName: 'ct-test', virtualIp: '10.42.0.2', peerCount: 1, directPeerCount: 1, error: null,
    telemetry: sample(bytes, bytes), }] });
  const store = createNetworkStore([network], runtime, { telemetry: f.telemetry });
  await store.getState().refreshRuntime();
  let notifications = 0; store.subscribe(() => { notifications++; });
  for (bytes = 1000; bytes <= 5000; bytes += 1000) { f.at(bytes); await store.getState().refreshRuntime(); }
  assert.equal(notifications, 0); assert.equal(f.get().download, 1000);
  runtime.snapshot = async () => { throw { code: 'request_timeout' }; };
  await store.getState().refreshRuntime();
  assert.equal(f.get().freshness, 'stale'); assert.equal(store.getState().networks[0].coreState, 'unknown');
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
