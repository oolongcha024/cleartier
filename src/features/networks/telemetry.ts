import { createStore } from 'zustand/vanilla';
import type { CoreState, Peer } from './model.ts';

export interface TelemetrySnapshot {
  session: string;
  elapsedMs: number;
  hostname: string;
  peers: Peer[];
  downloadBytes: string;
  uploadBytes: string;
  incomplete: boolean;
}
export interface TrafficPoint {
  at: number;
  download: number | null;
  upload: number | null;
}
type Freshness = 'empty' | 'fresh' | 'stale' | 'stopped';
export interface NetworkTraffic {
  snapshot: Omit<TelemetrySnapshot, 'peers'> | null;
  freshness: Freshness;
  download: number | null;
  upload: number | null;
  points: TrafficPoint[];
  updatedAt: number | null;
}
export interface NetworkDevices {
  peers: Peer[];
  freshness: Freshness;
}
export const emptyTraffic: NetworkTraffic = {
  snapshot: null,
  freshness: 'empty',
  download: null,
  upload: null,
  points: [],
  updatedAt: null,
};
export const emptyDevices: NetworkDevices = { peers: [], freshness: 'empty' };
interface Presentation {
  traffic: NetworkTraffic;
  devices: NetworkDevices;
}
interface Entry extends Presentation {
  latest: TelemetrySnapshot | null;
  metricsAt: number;
  baseline: boolean;
}
const qualityInterval = 3000;
const staleAfter = 3000;
const historyWindow = 60_000;

function sameStructure(a: Peer, b: Peer) {
  return (
    a.id === b.id &&
    a.instanceId === b.instanceId &&
    a.publicServer === b.publicServer &&
    a.name === b.name &&
    a.ip === b.ip &&
    a.connection === b.connection &&
    a.nextHop === b.nextHop &&
    a.version === b.version &&
    (a.protocols ?? []).length === (b.protocols ?? []).length &&
    (a.protocols ?? []).every((protocol, index) => protocol === b.protocols?.[index])
  );
}

// One sampling input, two independent read models. Receipt freshness, metric
// publication and window visibility have separate clocks and responsibilities.
export function createTelemetryStore(now = () => performance.now()) {
  const store = createStore<Record<string, Presentation>>(() => ({}));
  const entries = new Map<string, Entry>();
  let visible = true;
  const entryFor = (id: string) => {
    let entry = entries.get(id);
    if (!entry) {
      entry = {
        traffic: emptyTraffic,
        devices: emptyDevices,
        latest: null,
        metricsAt: 0,
        baseline: false,
      };
      entries.set(id, entry);
    }
    return entry;
  };
  const publish = (id: string, entry: Entry) => {
    if (!visible) return;
    const previous = store.getState()[id];
    if (previous?.traffic === entry.traffic && previous?.devices === entry.devices) return;
    store.setState({ [id]: { traffic: entry.traffic, devices: entry.devices } });
  };
  const updateDevices = (entry: Entry, force = false) => {
    const { freshness } = entry.traffic;
    const fresh = freshness === 'fresh';
    const due =
      force || entry.devices.freshness !== 'fresh' || now() - entry.metricsAt >= qualityInterval;
    const previous = new Map(entry.devices.peers.map((peer) => [peer.id, peer]));
    const source = freshness === 'stopped' ? [] : (entry.latest?.peers ?? []);
    const peers = source.map((peer) => {
      const before = previous.get(peer.id);
      const reseed =
        !before || before.instanceId !== peer.instanceId || before.connection !== peer.connection;
      const measured = fresh && peer.connection === 'direct';
      const latency = measured
        ? due || reseed || peer.latency === null
          ? peer.latency
          : before!.latency
        : null;
      const lossRate = measured
        ? due || reseed || peer.lossRate == null
          ? peer.lossRate
          : before!.lossRate
        : null;
      if (
        before &&
        sameStructure(before, peer) &&
        before.latency === latency &&
        before.lossRate === lossRate
      )
        return before;
      return { ...peer, latency, lossRate };
    });
    const unchanged =
      peers.length === entry.devices.peers.length &&
      peers.every((peer, index) => peer === entry.devices.peers[index]);
    if (!unchanged || entry.devices.freshness !== freshness)
      entry.devices = { peers: unchanged ? entry.devices.peers : peers, freshness };
    if (fresh && due) entry.metricsAt = now();
  };
  const stale = (id: string) => {
    const entry = entries.get(id);
    if (!entry || ['stale', 'stopped', 'empty'].includes(entry.traffic.freshness)) return;
    const at = now();
    entry.baseline = false;
    entry.traffic = {
      ...entry.traffic,
      freshness: 'stale',
      download: null,
      upload: null,
      points: [
        ...entry.traffic.points.filter((point) => point.at >= at - historyWindow),
        { at, download: null, upload: null },
      ],
    };
    updateDevices(entry);
    publish(id, entry);
  };
  const expire = () => {
    for (const [id, { traffic }] of entries) {
      if (
        traffic.freshness === 'fresh' &&
        traffic.updatedAt !== null &&
        now() - traffic.updatedAt >= staleAfter
      )
        stale(id);
    }
  };
  return {
    store,
    receive(id: string, snapshot: TelemetrySnapshot | null | undefined, state: CoreState) {
      const entry = entryFor(id);
      const current = entry.traffic;
      if (state === 'unknown') {
        stale(id);
        return;
      }
      const stopped = state === 'stopped' || state === 'failed';
      const stop = () => {
        entry.baseline = false;
        if (entry.traffic.freshness !== 'stopped')
          entry.traffic = { ...entry.traffic, freshness: 'stopped', download: null, upload: null };
        updateDevices(entry);
        publish(id, entry);
      };
      if (!snapshot) {
        if (stopped) stop();
        else stale(id);
        return;
      }
      const previous = entry.latest;
      const same = previous?.session === snapshot.session;
      if (same && snapshot.elapsedMs < previous.elapsedMs) return;
      if (same && snapshot.elapsedMs === previous.elapsedMs) {
        if (stopped) stop();
        return;
      }
      const at = now();
      let download: number | null = null,
        upload: number | null = null;
      const elapsed = previous && same ? snapshot.elapsedMs - previous.elapsedMs : 0;
      if (
        entry.baseline &&
        !stopped &&
        same &&
        current.freshness === 'fresh' &&
        elapsed > 0 &&
        elapsed <= staleAfter
      ) {
        try {
          const rx = BigInt(snapshot.downloadBytes) - BigInt(previous!.downloadBytes);
          const tx = BigInt(snapshot.uploadBytes) - BigInt(previous!.uploadBytes);
          if (rx >= BigInt(0) && tx >= BigInt(0)) {
            download = (Number(rx) * 1000) / elapsed;
            upload = (Number(tx) * 1000) / elapsed;
          }
        } catch {
          /* Invalid counters remain unknown. */
        }
      }
      const points = same ? current.points.filter((point) => point.at >= at - historyWindow) : [];
      entry.latest = snapshot;
      entry.baseline = !stopped;
      entry.traffic = {
        snapshot: {
          session: snapshot.session,
          elapsedMs: snapshot.elapsedMs,
          hostname: snapshot.hostname,
          downloadBytes: snapshot.downloadBytes,
          uploadBytes: snapshot.uploadBytes,
          incomplete: snapshot.incomplete,
        },
        freshness: stopped ? 'stopped' : 'fresh',
        updatedAt: at,
        download,
        upload,
        points: [...points, { at, download, upload }].slice(-121),
      };
      if (!same) entry.devices = emptyDevices;
      updateDevices(entry, !same);
      publish(id, entry);
    },
    stale,
    expire,
    setVisible(next: boolean) {
      if (next === visible) return;
      // Expire from actual receipt time before exposing a previously hidden view.
      expire();
      visible = next;
      if (!visible) return;
      const at = now();
      const presentation: Record<string, Presentation> = {};
      for (const [id, entry] of entries) {
        entry.traffic = {
          ...entry.traffic,
          points: entry.traffic.points.filter((point) => point.at >= at - historyWindow),
        };
        updateDevices(entry, true);
        presentation[id] = { traffic: entry.traffic, devices: entry.devices };
      }
      store.setState(presentation, true);
    },
    remove(id: string) {
      entries.delete(id);
      if (visible) {
        const next = { ...store.getState() };
        delete next[id];
        store.setState(next, true);
      }
    },
  };
}
export type TelemetryStore = ReturnType<typeof createTelemetryStore>;
