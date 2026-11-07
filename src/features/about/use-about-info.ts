import { useEffect, useState } from 'react';
import { coreVersion, isDesktop, previewClientVersion, readClientVersion } from '../../platform/client';

export function useAboutInfo() {
  const desktop = isDesktop();
  const [clientVersion, setClientVersion] = useState<string | null>(desktop ? null : previewClientVersion);
  const [versionUnavailable, setVersionUnavailable] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void readClientVersion().then((value) => {
      if (active) setClientVersion(value);
    }).catch(() => {
      if (active) setVersionUnavailable(true);
    });
    return () => { active = false; };
  }, [desktop]);
  return { clientVersion, versionUnavailable, coreVersion, desktop };
}
