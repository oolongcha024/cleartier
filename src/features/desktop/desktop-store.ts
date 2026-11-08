import { create } from 'zustand';
import {
  readDesktop,
  updateDesktop,
  watchDesktop,
  type DesktopStatus,
  type DesktopUpdate,
} from '../../platform/desktop';

interface DesktopState {
  status: DesktopStatus | null;
  error: string | null;
  saving: boolean;
  refresh: () => Promise<void>;
  update: (update: DesktopUpdate) => Promise<boolean>;
}
let generation = 0;
export const useDesktopStore = create<DesktopState>((set, get) => ({
  status: null,
  error: null,
  saving: false,
  refresh: async () => {
    const token = ++generation;
    try {
      const status = await readDesktop();
      if (token === generation) set({ status, error: null });
    } catch {
      if (token === generation) set({ error: 'read' });
    }
  },
  update: async (update) => {
    if (get().saving) return false;
    const token = ++generation;
    set({ saving: true, error: null });
    try {
      const status = await updateDesktop(update);
      if (token === generation) set({ status, error: null });
      else await get().refresh();
      return true;
    } catch (error) {
      // A failed OS operation can partially succeed; always re-read its truth.
      await get().refresh();
      set({ error: typeof error === 'string' ? error : 'save' });
      return false;
    } finally {
      set({ saving: false });
    }
  },
}));

// One subscription for the whole shell, including when Settings is unmounted.
export function subscribeDesktop() {
  let disposed = false;
  let unlisten: (() => void) | undefined;
  const refresh = () => {
    void useDesktopStore.getState().refresh();
  };
  void watchDesktop(refresh)
    .then((stop) => {
      if (disposed) stop();
      else unlisten = stop;
    })
    .catch(() => {
      if (!disposed) useDesktopStore.setState({ error: 'read' });
    });
  refresh();
  window.addEventListener('focus', refresh);
  return () => {
    disposed = true;
    unlisten?.();
    window.removeEventListener('focus', refresh);
  };
}
