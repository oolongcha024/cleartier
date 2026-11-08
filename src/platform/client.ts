import { getVersion } from '@tauri-apps/api/app';
import { invoke, isTauri } from '@tauri-apps/api/core';
import { version } from '../../package.json';

export interface HostEnvironment {
  hostname: string;
  platform: 'windows' | 'linux' | 'macos' | 'unknown';
  preview: boolean;
  unavailable?: boolean;
}

export const isDesktop = () => isTauri();

// Browser preview demonstrates Windows without claiming access to the host.
export async function readHostEnvironment(): Promise<HostEnvironment> {
  if (!isDesktop()) return { hostname: 'ClearTier-PC', platform: 'windows', preview: true };
  try {
    const [hostname, platform] = await invoke<[string, string]>('host_environment');
    return {
      hostname,
      platform: platform === 'windows' || platform === 'linux' || platform === 'macos' ? platform : 'unknown',
      preview: false,
    };
  } catch {
    return { hostname: '', platform: 'unknown', preview: false, unavailable: true };
  }
}

// Native failures propagate so the view can distinguish unavailable from loading.
export function readClientVersion(): Promise<string> {
  return isDesktop() ? getVersion() : Promise.resolve(version);
}

// Read the linked core itself; preview never invents a native version.
export function readCoreVersion(): Promise<string | null> {
  return isDesktop() ? invoke<string>('core_version') : Promise.resolve(null);
}
export const previewClientVersion = version;
