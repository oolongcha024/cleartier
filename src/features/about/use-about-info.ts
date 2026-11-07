import { useEffect, useState } from 'react';
import { getVersion } from '@tauri-apps/api/app';
import { isTauri } from '@tauri-apps/api/core';
import { version } from '../../../package.json';

export function useAboutInfo() {
  const desktop = isTauri();
  const [clientVersion, setClientVersion] = useState<string | null>(desktop ? null : version);
  const [versionUnavailable, setVersionUnavailable] = useState(false);
  useEffect(() => {
    if (!desktop) return;
    let active = true;
    void getVersion().then((value) => {
      if (active) setClientVersion(value);
    }).catch(() => {
      if (active) setVersionUnavailable(true);
    });
    return () => { active = false; };
  }, [desktop]);
  // No EasyTier runtime is bundled or connected yet. An upstream release or
  // frontend dependency version must never stand in for the actual core version.
  const coreVersion: string | null = null;
  return { clientVersion, versionUnavailable, coreVersion, desktop };
}
