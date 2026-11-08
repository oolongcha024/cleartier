import { useEffect } from 'react';
import { telemetry, useNetworkStore } from './store';

// Mounted once by the application. Layout and route lifetimes own no sampling.
export function NetworkLifecycle() {
  const initialize = useNetworkStore((state) => state.initialize);
  const refresh = useNetworkStore((state) => state.refreshRuntime);
  useEffect(() => {
    void initialize();
    const timer = setInterval(() => {
      telemetry.expire();
      void refresh();
    }, 1000);
    const focused = () => {
      void refresh();
    };
    window.addEventListener('focus', focused);
    return () => {
      clearInterval(timer);
      window.removeEventListener('focus', focused);
    };
  }, [initialize, refresh]);
  return null;
}
