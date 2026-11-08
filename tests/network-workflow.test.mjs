import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationDraft, hasPendingConfig } from '../src/features/networks/configuration.ts';
import { createNetworkStore, newNetworkDraft } from '../src/features/networks/network-store.ts';
import { documentFromNetworks, emptyDocument } from '../src/features/networks/persistence.ts';
import { fixture, profile, deferred, idle } from './helpers/networks.mjs';
const status = async (task, expected = 'completed') => assert.equal((await task).status, expected);

// Test the workflow Interface with genuinely asynchronous storage/runtime adapters.
test('deletion reserves its target before native confirmation or disk I/O; other networks remain operable', async () => {
  const f = fixture(); await f.store.getState().initialize();
  const [a, b] = f.profiles.map((network) => network.id);
  const gate = deferred(), entered = deferred();
  f.disk.beforeSave = () => { entered.resolve(); return gate.promise; };
  const removing = f.store.getState().remove(a);
  await entered.promise;
  await status(f.store.getState().connect(a), 'busy');
  await status(f.store.getState().save(a, configurationDraft(f.get(a))), 'busy');
  await status(f.store.getState().connect(b));
  assert.equal(f.get(a).operation, 'removing');
  gate.resolve(); await status(removing);
  assert.equal(f.get(a), undefined);
  assert.deepEqual(f.calls.map((call) => call.action), ['release', 'start']);
});
test('native recovery starting or stale observation cannot authorize durable deletion', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id;
  f.put({ id, state: 'starting', recoveryConfig: f.get().savedConfig, recovery: { phase: 'starting', attempt: 1, maxAttempts: 3, retryInSeconds: 0 } });
  await status(f.store.getState().remove(id), 'in-use');
  assert.equal(f.writes.length, 0); assert.ok(f.get());
  f.control.failRead = { code: 'request_timeout' };
  await status(f.store.getState().refreshRuntime(), 'runtime-error');
  await status(f.store.getState().remove(id), 'in-use');
});
test('failed deletion preserves durable record and selection; retry succeeds', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id;
  f.disk.fail = { code: 'io' };
  await status(f.store.getState().remove(id), 'storage-error');
  assert.ok(f.get()); assert.equal(f.store.getState().selectedId, id);
  assert.equal(f.get().operation, null);
  f.disk.fail = null; await status(f.store.getState().remove(id)); assert.equal(f.get(id), undefined);
});
test('save-now captures parameters through disk and runtime waits; preference patches survive', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id;
  await status(f.store.getState().connect(id));
  const draft = { ...configurationDraft(f.get()), secret: 'new key' };
  const before = structuredClone(f.get().runningConfig);
  assert.equal((await f.store.getState().save(id, draft)).status, 'confirmation-required');
  assert.deepEqual(f.get().savedConfig, before);
  const gate = deferred(); f.control.before = () => gate.promise;
  const result = await f.store.getState().save(id, draft, 'now');
  assert.equal(result.status, 'applying'); assert.equal(f.get().operation, 'reconnecting');
  await status(f.store.getState().save(id, configurationDraft(f.get()), 'later'), 'busy');
  await Promise.all([f.store.getState().setAutoConnect(id, true), f.store.getState().selectNetwork(f.profiles[1].id)]);
  gate.resolve(); await status(result.completion);
  assert.equal(f.get(id).runningConfig.secret, 'new key'); assert.equal(f.get(id).autoConnect, true);
  assert.equal(f.store.getState().selectedId, f.profiles[1].id); assert.equal(hasPendingConfig(f.get(id)), false);
});
test('failed persistence never applies; failed explicit apply preserves saved changes without rollback', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id;
  await f.store.getState().connect(id);
  const before = structuredClone(f.get());
  const draft = { ...configurationDraft(before), secret: 'next' };
  f.disk.fail = { code: 'io' };
  await status(f.store.getState().save(id, draft, 'now'), 'storage-error');
  assert.deepEqual(f.get().savedConfig, before.savedConfig); assert.equal(f.calls.length, 1);
  f.disk.fail = null; f.control.before = async () => { throw { code: 'tun_failed' }; };
  const result = await f.store.getState().save(id, draft, 'now'); await status(result.completion, 'runtime-error');
  assert.equal(f.get().savedConfig.secret, 'next'); assert.equal(f.get().runningConfig, null);
  assert.equal(f.get().connectionError.code, 'tun_failed'); assert.deepEqual(f.calls.map((call) => call.action), ['start', 'restart']);
});
test('draft baselines reject stale configuration, but selection and peer preferences do not invalidate edits', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id;
  const stale = configurationDraft(f.get());
  await f.store.getState().setAutoConnect(id, true);
  await f.store.getState().setPeerIcon(id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1', 'phone');
  await status(f.store.getState().save(id, { ...stale, alias: 'renamed' }), 'saved');
  await status(f.store.getState().save(id, { ...stale, secret: 'stale' }), 'stale');
  assert.equal(f.get().savedConfig.secret, stale.secret); assert.equal(f.get().peerIcons['aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1'], 'phone');
});
test('local presentation changes preserve pending connection parameters and never restart', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id;
  await f.store.getState().connect(id);
  await f.store.getState().save(id, { ...configurationDraft(f.get()), secret: 'pending' }, 'later');
  const active = structuredClone(f.get().runningConfig);
  const result = await f.store.getState().save(id, { ...configurationDraft(f.get()), alias: 'local', icon: 'dns' });
  assert.deepEqual(result, { status: 'saved', pending: true });
  assert.deepEqual(f.get().runningConfig, active); assert.equal(f.calls.length, 1);
});
test('offline save never connects; explicit operations do not invert intent', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id;
  await status(f.store.getState().save(id, { ...configurationDraft(f.get()), secret: 'next' }), 'saved');
  assert.equal(f.calls.length, 0); await status(f.store.getState().reconnect(id), 'in-use');
  await status(f.store.getState().connect(id)); await status(f.store.getState().connect(id), 'in-use');
  assert.equal(f.get().runningConfig.secret, 'next');
  await status(f.store.getState().disconnect(id)); assert.equal(f.get().runningConfig, null);
});
test('a delayed read cannot undo a newer command; network revisions are merged independently', async () => {
  const f = fixture(); await f.store.getState().initialize(); const [a, b] = f.profiles.map((network) => network.id);
  const gate = deferred(), original = f.runtime.snapshot;
  f.runtime.snapshot = () => gate.promise;
  const read = f.store.getState().refreshRuntime();
  await f.store.getState().connect(a); await f.store.getState().connect(b);
  gate.resolve({ epoch: 'test-runtime', health: 'ready', error: null, networks: [] }); await read;
  assert.equal(f.get(a).coreState, 'running'); assert.equal(f.get(b).coreState, 'running');
  f.runtime.snapshot = original;
  const newer = f.frame(); newer.networks.find((item) => item.id === a).revision += 100;
  f.runtime.snapshot = async () => newer; await f.store.getState().refreshRuntime();
  f.put({ ...f.frame().networks.find((item) => item.id === b), peerCount: 7 });
  f.runtime.snapshot = original; await f.store.getState().refreshRuntime();
  assert.equal(f.get(b).peerCount, 7);
});
test('query failure retains running parameters and recovers without inventing success', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id; await f.store.getState().connect(id);
  const active = structuredClone(f.get().runningConfig);
  f.control.failRead = { code: 'request_timeout' }; await status(f.store.getState().refreshRuntime(), 'runtime-error');
  assert.equal(f.get().coreState, 'unknown'); assert.deepEqual(f.get().runningConfig, active);
  await status(f.store.getState().connect(id), 'not-ready');
  f.control.failRead = null; await status(f.store.getState().refreshRuntime()); assert.equal(f.get().coreState, 'running');
});
test('reload preserves active sessions, retains externally removed instances, and never replays startup', async () => {
  const a = profile('automatic'); a.autoConnect = true; const f = fixture([a]);
  await f.store.getState().initialize(); await idle(f.store); assert.equal(f.calls.length, 1);
  await status(f.store.getState().reload()); await idle(f.store); assert.equal(f.calls.length, 1);
  f.replaceDocument({ ...emptyDocument(), revision: crypto.randomUUID() });
  await status(f.store.getState().reload()); assert.equal(f.get().persisted, false); assert.equal(f.get().coreState, 'running');
  await status(f.store.getState().disconnect(a.id)); assert.equal(f.saved().networks.length, 0);
  await status(f.store.getState().remove(a.id)); assert.equal(f.store.getState().networks.length, 0);
});
test('reload and restore cannot interleave durable mutations; initialization is shared', async () => {
  const f = fixture(); const first = f.store.getState().initialize(); assert.equal(f.store.getState().initialize(), first); await first;
  const gate = deferred(), entered = deferred(); f.disk.beforeSave = () => { entered.resolve(); return gate.promise; };
  const save = f.store.getState().save(f.get().id, { ...configurationDraft(f.get()), alias: 'changed' }); await entered.promise;
  await status(f.store.getState().reload(), 'busy'); await status(f.store.getState().restore(), 'busy'); gate.resolve(); await save;
});
test('startup queue stops after cancelled authorization and never connects manual profiles', async () => {
  const profiles = [profile('one'), profile('two'), profile('manual')]; profiles[0].autoConnect = profiles[1].autoConnect = true;
  const f = fixture(profiles); f.control.before = async () => { throw { code: 'elevation_cancelled' }; };
  await f.store.getState().initialize(); await idle(f.store);
  assert.equal(f.calls.length, 1); assert.equal(f.store.getState().autoConnectCancelled, true);
  await f.store.getState().reload(); assert.equal(f.calls.length, 1);
  f.control.before = null; await status(f.store.getState().connect(profiles[1].id));
});
test('recovery parameters remain separate from saved edits and actual running configuration', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id; await f.store.getState().connect(id);
  const running = structuredClone(f.get().runningConfig);
  await f.store.getState().save(id, { ...configurationDraft(f.get()), secret: 'pending' }, 'later');
  f.put({ id, state: 'failed', recoveryConfig: running, recovery: { phase: 'waiting', attempt: 0, maxAttempts: 3, retryInSeconds: 2 } });
  await f.store.getState().refreshRuntime(); assert.equal(f.get().runningConfig, null); assert.deepEqual(f.get().recoveryConfig, running);
  assert.equal(hasPendingConfig(f.get()), true); await status(f.store.getState().remove(id), 'in-use');
  await status(f.store.getState().disconnect(id)); assert.equal(f.get().recoveryConfig, null); assert.equal(f.get().savedConfig.secret, 'pending');
});
test('new configuration, record, client and document extensions survive the complete workflow', async () => {
  const network = profile(' exact name '); network.savedConfig.secret = ' exact key ';
  network.savedConfig.futureCore = { nested: true };
  const doc = documentFromNetworks(emptyDocument(), [network], network.id);
  doc.futureRoot = 1; doc.networks[0].futureRecord = 2; doc.networks[0].client.futureClient = 3;
  const f = fixture([network], doc); await f.store.getState().initialize();
  await status(f.store.getState().save(network.id, { ...configurationDraft(f.get()), alias: 'local' }), 'saved');
  const saved = f.saved(); assert.equal(saved.futureRoot, 1); assert.equal(saved.networks[0].futureRecord, 2);
  assert.equal(saved.networks[0].client.futureClient, 3); assert.deepEqual(saved.networks[0].config, network.savedConfig);
  assert.equal(saved.networks[0].runningConfig, undefined);
});
test('failed load cannot overwrite data; explicit recovery and stale-writer conflicts remain visible', async () => {
  const f = fixture(); f.disk.failLoad = { code: 'invalid', backupAvailable: true };
  await status(f.store.getState().initialize(), 'storage-error');
  const candidate = newNetworkDraft([]);
  await status(f.store.getState().create(candidate.id, configurationDraft(candidate)), 'not-ready'); assert.equal(f.writes.length, 0);
  await status(f.store.getState().restore());
  const other = f.makeStore(); await other.getState().initialize();
  await f.store.getState().setAutoConnect(f.get().id, true);
  await status(other.getState().setAutoConnect(f.get().id, false), 'storage-error');
  assert.equal(other.getState().storageError.code, 'conflict'); await status(other.getState().reload());
});
test('queued additions and preference patches preserve one another and target selection', async () => {
  const f = fixture([]); await f.store.getState().initialize();
  const a = profile('a'), b = profile('b');
  const results = await Promise.all([f.store.getState().create(a.id, configurationDraft(a)), f.store.getState().create(b.id, configurationDraft(b))]);
  assert.deepEqual(results.map((result) => result.status), ['saved', 'saved']);
  await Promise.all([f.store.getState().selectNetwork(a.id), f.store.getState().setAutoConnect(b.id, true)]);
  assert.equal(f.saved().networks.length, 2); assert.equal(f.saved().selectedId, a.id); assert.equal(f.saved().networks[1].client.autoConnect, true);
});
test('independent workspace instances never share runtime or durable state', async () => {
  const a = fixture(), b = fixture(); await Promise.all([a.store.getState().initialize(), b.store.getState().initialize()]);
  await a.store.getState().connect(a.get().id); assert.equal(b.get().coreState, 'stopped'); assert.equal(b.calls.length, 0);
});

test('cold native cache waits for the first authoritative observation before startup auto-connect', async () => {
  const network = profile('startup'); network.autoConnect = true;
  const f = fixture([network]); f.control.health = 'initializing';
  await f.store.getState().initialize(); assert.equal(f.get().coreState, 'unknown'); assert.equal(f.calls.length, 0);
  f.control.health = 'ready'; await f.store.getState().refreshRuntime(); await idle(f.store);
  assert.equal(f.calls.length, 1); assert.equal(f.get().coreState, 'running');
});
test('a delayed pre-delete frame cannot recreate a removed network', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id;
  const gate = deferred(), readEntered = deferred(), original = f.runtime.snapshot;
  f.runtime.snapshot = () => { readEntered.resolve(); return gate.promise; };
  const reading = f.store.getState().refreshRuntime(); await readEntered.promise;
  await status(f.store.getState().remove(id));
  const removed = f.profiles[0];
  f.put({ id, state: 'running', runningConfig: removed.savedConfig });
  gate.resolve(f.frame()); await reading;
  assert.equal(f.get(id), undefined); f.runtime.snapshot = original;
});
test('a runtime-only network discovered during a durable write remains stoppable after it commits', async () => {
  const f = fixture(); await f.store.getState().initialize();
  const gate = deferred(), entered = deferred(); f.disk.beforeSave = () => { entered.resolve(); return gate.promise; };
  const writing = f.store.getState().setAutoConnect(f.get().id, true); await entered.promise;
  const orphan = profile('external'); f.put({ id: orphan.id, state: 'running', runningConfig: orphan.savedConfig });
  await f.store.getState().refreshRuntime(); assert.equal(f.get(orphan.id).persisted, false);
  gate.resolve(); await writing; assert.equal(f.get(orphan.id).coreState, 'running');
  assert.equal(f.saved().networks.some((network) => network.id === orphan.id), false);
});
test('advanced parameters survive save and isolated apply through the same interface', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id; await f.store.getState().connect(id);
  const draft = { ...configurationDraft(f.get()), hostname: 'custom-node', ipv4Mode: 'manual', ipv4Address: '10.88.0.9', ipv4Prefix: '25',
    tunName: 'ct-custom', mtu: '1300', ipv6: false, p2pPolicy: 'lazy', latencyFirst: true, tcpHolePunching: false,
    udpHolePunching: false, upnp: false, magicDns: true, dnsSuffix: 'office.lan.', udpBroadcastRelay: true };
  const result = await f.store.getState().save(id, draft, 'now'); await status(result.completion);
  const config = f.get().runningConfig;
  for (const field of ['hostname','ipv4Mode','ipv4Address','tunName','ipv6','p2pPolicy','latencyFirst','tcpHolePunching','udpHolePunching','upnp','magicDns','dnsSuffix','udpBroadcastRelay']) assert.equal(config[field], draft[field], field);
  assert.equal(config.mtu, 1300); assert.equal(config.ipv4Prefix, 25); assert.equal(hasPendingConfig(f.get()), false);
});
test('an adapter returning a stale quiescence frame does not authorize deletion', async () => {
  const f = fixture(); await f.store.getState().initialize();
  f.runtime.confirmQuiescent = async () => ({ ...f.frame(), health: 'stale', error: { code: 'request_timeout' } });
  await status(f.store.getState().remove(f.get().id), 'in-use'); assert.equal(f.writes.length, 0); assert.ok(f.get());
});
test('runtime unavailability still permits saving configuration for later without issuing runtime work', async () => {
  const f = fixture(); await f.store.getState().initialize(); const id = f.get().id; await f.store.getState().connect(id);
  f.control.failRead = { code: 'request_timeout' }; await f.store.getState().refreshRuntime();
  const result = await f.store.getState().save(id, { ...configurationDraft(f.get()), secret: 'later' }, 'later');
  assert.equal(result.status, 'saved'); assert.equal(result.pending, true); assert.equal(f.calls.length, 1);
});
