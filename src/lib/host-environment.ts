import { useEffect, useState } from 'react';
import { invoke, isTauri } from '@tauri-apps/api/core';

export interface HostEnvironment {
  hostname: string; platform: 'windows' | 'linux' | 'macos' | 'unknown';
  preview: boolean; unavailable?: boolean;
}
// Browser preview demonstrates the Windows client without claiming access to
// the visitor's hostname or interfaces. Native calls stay behind isTauri().
const previewEnvironment: HostEnvironment = { hostname: 'ClearTier-PC', platform: 'windows', preview: true };
let environmentRequest: Promise<HostEnvironment> | undefined;
async function readEnvironment(): Promise<HostEnvironment> {
  if (!isTauri()) return previewEnvironment;
  try {
    const [hostname, platform] = await invoke<[string, string]>('host_environment');
    return { hostname, platform: platform === 'windows' || platform === 'linux' || platform === 'macos' ? platform : 'unknown', preview: false };
  } catch {
    return { hostname: '', platform: 'unknown', preview: false, unavailable: true };
  }
}
export function useHostEnvironment(): HostEnvironment | null {
  const [environment, setEnvironment] = useState<HostEnvironment | null>(null);
  useEffect(() => {
    let active = true;
    environmentRequest ??= readEnvironment();
    void environmentRequest.then((value) => { if (active) setEnvironment(value); });
    return () => { active = false; };
  }, []);
  return environment;
}
