import { useEffect, useState } from 'react';
import { isDesktop, previewClientVersion, readClientVersion, readCoreVersion } from '../../platform/client';

export function useAboutInfo() {
  const desktop = isDesktop();
  const [clientVersion, setClientVersion] = useState<string | null>(desktop ? null : previewClientVersion);
  const [versionUnavailable, setVersionUnavailable] = useState(false);
  const [coreVersion, setCoreVersion] = useState<string | null>(null);
  const [coreVersionUnavailable, setCoreVersionUnavailable] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void Promise.allSettled([readClientVersion(), readCoreVersion()]).then(([client, core]) => {
      if (!active) return;
      if (client.status === 'fulfilled') setClientVersion(client.value);
      else setVersionUnavailable(true);
      if (core.status === 'fulfilled') setCoreVersion(core.value);
      else setCoreVersionUnavailable(true);
    });
    return () => { active = false; };
  }, [desktop]);
  return { clientVersion, versionUnavailable, coreVersion, coreVersionUnavailable, desktop };
}
