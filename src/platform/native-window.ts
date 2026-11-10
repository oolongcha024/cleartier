import { getCurrentWindow } from '@tauri-apps/api/window';

// Desktop blur alone does not mean hidden. Query native visibility and minimized
// state on window events. Document visibility remains a native failure fallback.
export function watchNativeWindowVisibility(changed: (visible: boolean) => void): () => void {
  let disposed = false;
  let generation = 0;
  let previous: boolean | undefined;
  const listeners: (() => void)[] = [];
  const publish = (visible: boolean) => {
    if (!disposed && previous !== visible) {
      previous = visible;
      changed(visible);
    }
  };
  const refresh = async () => {
    const token = ++generation;
    let visible = document.visibilityState !== 'hidden';
    try {
      const current = getCurrentWindow();
      const [shown, minimized] = await Promise.all([current.isVisible(), current.isMinimized()]);
      visible = shown && !minimized;
    } catch {
      // A failed visibility query must not prevent initialization or recovery.
      // Keep the last known native state, with document visibility as fallback.
      visible = previous ?? visible;
    }
    if (token === generation) publish(visible);
  };
  const update = () => {
    void refresh();
  };
  document.addEventListener('visibilitychange', update);
  window.addEventListener('focus', update);
  window.addEventListener('blur', update);
  const current = getCurrentWindow();
  for (const registration of [current.onFocusChanged(update), current.onResized(update)]) {
    void registration
      .then((stop) => {
        if (disposed) stop();
        else listeners.push(stop);
      })
      .catch(() => {
        /* DOM events still provide refresh opportunities. */
      });
  }

  update();
  return () => {
    disposed = true;
    generation++;
    document.removeEventListener('visibilitychange', update);
    window.removeEventListener('focus', update);
    window.removeEventListener('blur', update);
    listeners.forEach((stop) => stop());
  };
}
