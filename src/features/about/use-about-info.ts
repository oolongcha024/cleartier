import { useEffect, useState } from 'react';
import { readClientVersion, readCoreVersion } from '../../platform/client';

export function useAboutInfo() {
  const [clientVersion, setClientVersion] = useState<string | null>(null);
  const [versionUnavailable, setVersionUnavailable] = useState(false);
  const [coreVersion, setCoreVersion] = useState<string | null>(null);
  const [coreVersionUnavailable, setCoreVersionUnavailable] = useState(false);
  useEffect(() => {
    let active = true;
    void Promise.allSettled([readClientVersion(), readCoreVersion()]).then(([client, core]) => {
      if (!active) return;
      if (client.status === 'fulfilled') setClientVersion(client.value);
      else setVersionUnavailable(true);
      if (core.status === 'fulfilled') setCoreVersion(core.value);
      else setCoreVersionUnavailable(true);
    });
    return () => {
      active = false;
    };
  }, []);
  return { clientVersion, versionUnavailable, coreVersion, coreVersionUnavailable };
}
