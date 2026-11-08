import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createUpdateStore } from '../src/features/updates/update-store.ts';

const snapshot = (revision, phase = 'idle') => ({ revision, distribution: 'installed', preferences: { automatic: true, prereleases: false },
  phase, candidate: null, error: null, lastChecked: null, downloaded: 0, total: null });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const settle = () => new Promise(resolve => setImmediate(resolve));

test('late initial reads cannot undo a newer native progress event', async () => {
  const read = deferred(); let receive;
  const store = createUpdateStore({ read: () => read.promise, watch: async listener => { receive = listener; return () => {}; }, command: async () => snapshot(9) });
  const stop = store.getState().start(); await settle();
  receive(snapshot(5, 'downloading')); read.resolve(snapshot(1)); await settle();
  assert.equal(store.getState().snapshot.phase, 'downloading');
  assert.equal(store.getState().snapshot.revision, 5); stop();
});
test('cancelled downloads cannot resurrect stale UI or surface a cancellation as failure', async () => {
  const download = deferred(); let receive;
  const store = createUpdateStore({ read: async () => snapshot(1), watch: async listener => { receive = listener; return () => {}; },
    command: command => command.action === 'update' ? download.promise : Promise.resolve(snapshot(4, 'available')) });
  const stop = store.getState().start(); await settle();
  const updating = store.getState().run({ action: 'update', confirmed: false }); receive(snapshot(3, 'downloading'));
  await store.getState().run({ action: 'cancel' }); download.reject('cancelled'); await updating;
  assert.equal(store.getState().snapshot.phase, 'available'); assert.equal(store.getState().error, null); assert.equal(store.getState().pending, false); stop();
});
test('command errors remain visible and a successful retry clears them', async () => {
  let failed = true;
  const store = createUpdateStore({ read: async () => snapshot(1), watch: async () => () => {},
    command: async () => { if (failed) throw 'network'; return snapshot(2, 'current'); } });
  const stop = store.getState().start(); await settle();
  assert.equal(await store.getState().run({ action: 'check' }), false); assert.equal(store.getState().error, 'network');
  failed = false; assert.equal(await store.getState().run({ action: 'check' }), true);
  assert.equal(store.getState().error, null); assert.equal(store.getState().snapshot.phase, 'current'); stop();
});
test('disposing while the listener is being registered prevents leaked listeners and late reads', async () => {
  const read = deferred(), watch = deferred(); let stopped = 0;
  const store = createUpdateStore({ read: () => read.promise, watch: () => watch.promise, command: async () => snapshot(9) });
  const stop = store.getState().start(); stop(); watch.resolve(() => stopped++); read.resolve(snapshot(2)); await settle();
  assert.equal(stopped, 1); assert.equal(store.getState().snapshot, null);
});
