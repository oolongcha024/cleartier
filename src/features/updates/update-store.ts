import { createStore } from 'zustand/vanilla';
import type { UpdateAdapter, UpdateCommand, UpdateSnapshot } from '../../platform/updates.ts';

interface UpdateState {
  snapshot: UpdateSnapshot | null; error: string | null; pending: boolean;
  start: () => () => void;
  run: (command: UpdateCommand) => Promise<boolean>;
}
export function createUpdateStore(adapter: UpdateAdapter) {
  let sequence = 0;
  const store = createStore<UpdateState>((set, get) => {
    const receive = (snapshot: UpdateSnapshot) => {
      if (!snapshot || !Number.isFinite(snapshot.revision)) { set({ error: 'read' }); return; }
      if (!get().snapshot || snapshot.revision > get().snapshot!.revision) set({ snapshot, error: null });
    };
    return {
      snapshot: null, error: null, pending: false,
      start: () => {
        let disposed = false; let unwatch: (() => void) | undefined;
        void adapter.watch(snapshot => { if (!disposed) receive(snapshot); }).then(stop => {
          if (disposed) stop(); else unwatch = stop;
        }).catch(() => { if (!disposed) set({ error: 'read' }); });
        void adapter.read().then(snapshot => { if (!disposed) receive(snapshot); })
          .catch(() => { if (!disposed) set({ error: 'read' }); });
        return () => { disposed = true; unwatch?.(); };
      },
      run: async (command) => {
        const token = ++sequence;
        set({ pending: true, error: null });
        try { receive(await adapter.command(command)); return true; }
        catch (error) {
          if (token === sequence && error !== 'cancelled') set({ error: typeof error === 'string' ? error : 'read' });
          return false;
        } finally { if (token === sequence) set({ pending: false }); }
      },
    };
  });
  return store;
}
