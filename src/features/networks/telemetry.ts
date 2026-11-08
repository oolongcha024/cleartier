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
export interface NetworkTelemetry {
  snapshot: TelemetrySnapshot | null;
  freshness: 'empty' | 'fresh' | 'stale' | 'stopped';
  download: number | null;
  upload: number | null;
  points: TrafficPoint[];
  updatedAt: number | null;
}
export const emptyTelemetry: NetworkTelemetry = {
  snapshot: null,
  freshness: 'empty',
  download: null,
  upload: null,
  points: [],
  updatedAt: null,
};

// Sampling and chart history have their own subscription surface: byte changes
// never rebuild the saved-network list, editor, sidebar or connection controls.
export function createTelemetryStore(now = () => performance.now()) {
  const store = createStore<Record<string, NetworkTelemetry>>(() => ({}));
  const put = (id: string, value: NetworkTelemetry) => store.setState({ [id]: value });
  const stale = (id: string) => {
    const current = store.getState()[id];
    if (!current || current.freshness === 'stale' || current.freshness === 'stopped') return;
    const at = now();
    put(id, {
      ...current,
      freshness: 'stale',
      download: null,
      upload: null,
      points: [
        ...current.points.filter((point) => point.at >= at - 60_000),
        { at, download: null, upload: null },
      ],
    });
  };
  return {
    store,
    receive(id: string, snapshot: TelemetrySnapshot | null | undefined, state: CoreState) {
      const current = store.getState()[id] ?? emptyTelemetry;
      if (state === 'unknown') {
        stale(id);
        return;
      }
      if (!snapshot) {
        if (state === 'stopped' || state === 'failed') {
          if (current.freshness !== 'stopped')
            put(id, { ...current, freshness: 'stopped', download: null, upload: null });
        } else if (current.snapshot) stale(id);
        return;
      }
      const at = now();
      const previous = current.snapshot;
      const same = previous?.session === snapshot.session;
      // An old command response may contain an earlier sample from the same
      // session. It must not move totals backwards or produce negative rates.
      if (same && snapshot.elapsedMs < previous.elapsedMs) return;
      const duplicate = same && snapshot.elapsedMs === previous.elapsedMs;
      if (duplicate) {
        if ((state === 'stopped' || state === 'failed') && current.freshness !== 'stopped')
          put(id, { ...current, freshness: 'stopped', download: null, upload: null });
        return;
      }
      let download: number | null = null,
        upload: number | null = null;
      const elapsed = previous && same ? snapshot.elapsedMs - previous.elapsedMs : 0;
      if (same && current.freshness === 'fresh' && elapsed > 0 && elapsed <= 3000) {
        try {
          const rx = BigInt(snapshot.downloadBytes) - BigInt(previous!.downloadBytes);
          const tx = BigInt(snapshot.uploadBytes) - BigInt(previous!.uploadBytes);
          if (rx >= BigInt(0) && tx >= BigInt(0)) {
            download = (Number(rx) * 1000) / elapsed;
            upload = (Number(tx) * 1000) / elapsed;
          }
        } catch {
          /* Malformed/unavailable counters are never rendered as zero. */
        }
      }
      const stopped = state === 'stopped' || state === 'failed';
      if (stopped) {
        download = null;
        upload = null;
      }
      const points = same ? current.points.filter((point) => point.at >= at - 60_000) : [];
      put(id, {
        snapshot,
        freshness: stopped ? 'stopped' : 'fresh',
        updatedAt: at,
        download,
        upload,
        points: [...points, { at, download, upload }].slice(-121),
      });
    },
    stale,
    expire() {
      const at = now();
      for (const [id, current] of Object.entries(store.getState())) {
        if (
          current.freshness === 'fresh' &&
          current.updatedAt !== null &&
          at - current.updatedAt >= 3000
        )
          stale(id);
      }
    },
    remove(id: string) {
      store.setState((state) => {
        const next = { ...state };
        delete next[id];
        return next;
      }, true);
    },
  };
}
export type TelemetryStore = ReturnType<typeof createTelemetryStore>;
