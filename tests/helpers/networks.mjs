import { createNetworkStore, newNetworkDraft } from '../../src/features/networks/network-store.ts';
import { documentFromNetworks, emptyDocument } from '../../src/features/networks/persistence.ts';

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
export function profile(name = 'office', id = crypto.randomUUID()) {
  const network = newNetworkDraft([], id);
  network.alias = network.savedConfig.name = name;
  network.savedConfig.servers = ['tcp://example.com:11010'];
  return network;
}
export function scriptedRuntime(initial = []) {
  let revision = 0;
  let snapshots = structuredClone(initial);
  const calls = [];
  const control = { failRead: null, before: null, epoch: 'test-runtime', health: 'ready' };
  const frame = () => structuredClone({ epoch: control.epoch, health: control.health, error: null, networks: snapshots });
  const stopped = (id) => ({ id, revision: ++revision, state: 'stopped', runningConfig: null, recoveryConfig: null,
    deviceName: '', virtualIp: null, peerCount: 0, directPeerCount: 0, recovery: null, telemetry: null, error: null });
  const put = (value) => {
    snapshots = snapshots.filter((item) => item.id !== value.id);
    snapshots.push({ ...stopped(value.id), ...structuredClone(value), revision: ++revision });
  };
  const operation = async (action, id, config) => {
    calls.push(structuredClone({ action, id, ...(config ? { config } : {}) }));
    const previous = snapshots.find((snapshot) => snapshot.id === id);
    if (action === 'release') {
      if (previous && (previous.runningConfig || previous.recoveryConfig || !['stopped', 'failed'].includes(previous.state))) throw { code: 'operation_busy' };
      if (control.before) await control.before({ action, id, config });
      put(stopped(id)); return frame();
    }
    if (action === 'restart') put({ ...stopped(id), telemetry: previous?.telemetry ?? null });
    if (control.before) await control.before({ action, id, config });
    if (action === 'stop') put({ ...stopped(id), telemetry: previous?.telemetry ?? null });
    else {
      for (const other of snapshots) {
        if (other.id !== id && other.runningConfig?.name === config.name && other.runningConfig.secret === config.secret) throw { code: 'network_already_running' };
      }
      put({ id, state: 'running', runningConfig: structuredClone(config), deviceName: config.tunName, virtualIp: '10.42.0.2',
        telemetry: { session: `session-${revision}`, elapsedMs: 0, hostname: config.hostname || 'node', peers: [], downloadBytes: '0', uploadBytes: '0', incomplete: false } });
    }
    return frame();
  };
  const runtime = {
    snapshot: async () => { if (control.failRead) throw control.failRead; return frame(); },
    start: (id, config) => operation('start', id, config), restart: (id, config) => operation('restart', id, config),
    stop: (id) => operation('stop', id), confirmQuiescent: (id) => operation('release', id),
  };
  return { runtime, control, calls, frame, put, snapshots: () => snapshots, stopped };
}
export function fixture(profiles = [profile('office'), profile('game')], initialDocument) {
  let document = structuredClone(initialDocument ?? documentFromNetworks(emptyDocument(), profiles, profiles[0]?.id ?? ''));
  const native = scriptedRuntime();
  const writes = [];
  const disk = { fail: null, beforeSave: null, failLoad: null };
  const storage = {
    load: async () => { if (disk.failLoad) throw disk.failLoad; return structuredClone(document); },
    restore: async () => { disk.failLoad = null; return structuredClone(document); },
    save: async (next, expected) => {
      writes.push(structuredClone(next));
      if (disk.beforeSave) await disk.beforeSave(next);
      if (disk.fail) throw disk.fail;
      if (document.revision !== expected) throw { code: 'conflict' };
      document = { ...structuredClone(next), revision: crypto.randomUUID() };
      return structuredClone(document);
    },
  };
  const makeStore = (options = {}) => createNetworkStore(native.runtime, { storage, ...options });
  const store = makeStore();
  return { ...native, disk, writes, storage, store, makeStore, profiles, saved: () => structuredClone(document),
    replaceDocument: (next) => { document = structuredClone(next); }, get: (id = profiles[0]?.id) => store.getState().networks.find((network) => network.id === id) };
}
export async function idle(store) {
  for (let i = 0; i < 100; i++) {
    if (!store.getState().autoConnecting) return;
    await new Promise((resolve) => setImmediate(resolve));
  }
  throw new Error('Startup queue did not settle');
}
