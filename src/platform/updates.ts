import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktop } from './client';

export interface UpdatePreferences {
  automatic: boolean;
  prereleases: boolean;
}
export interface UpdateSnapshot {
  revision: number;
  distribution: 'installed' | 'portable' | 'unsupported' | 'preview';
  preferences: UpdatePreferences;
  phase: 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'installing';
  candidate: { version: string; notes: string } | null;
  error: string | null;
  lastChecked: number | null;
  retryAt: number | null;
  downloaded: number;
  total: number | null;
}
export type UpdateCommand =
  | { action: 'check' | 'cancel' | 'openRelease' | 'openZip' }
  | { action: 'configure'; preferences: UpdatePreferences }
  | { action: 'update'; confirmed: boolean };
export interface UpdateAdapter {
  read: () => Promise<UpdateSnapshot>;
  command: (command: UpdateCommand) => Promise<UpdateSnapshot>;
  watch: (receive: (snapshot: UpdateSnapshot) => void) => Promise<() => void>;
}
let revision = 0;
const previewKey = 'cleartier-preview-updates';
function preview(): UpdateSnapshot {
  let stored: Partial<UpdatePreferences> = {};
  try {
    const value = JSON.parse(localStorage.getItem(previewKey) ?? '{}');
    if (value && typeof value === 'object') stored = value;
  } catch {
    /* Preview only. */
  }
  return {
    revision,
    distribution: 'preview',
    preferences: {
      automatic: stored.automatic !== false,
      prereleases: stored.prereleases === true,
    },
    phase: 'idle',
    candidate: null,
    error: null,
    lastChecked: null,
    retryAt: null,
    downloaded: 0,
    total: null,
  };
}
export const updatesAdapter: UpdateAdapter = {
  read: () => (isDesktop() ? invoke('updates_status') : Promise.resolve(preview())),
  command: async (command) => {
    if (isDesktop()) return invoke('updates_command', { command });
    if (command.action === 'configure') {
      localStorage.setItem(previewKey, JSON.stringify(command.preferences));
      revision++;
    }
    return preview();
  },
  watch: async (receive) =>
    isDesktop()
      ? listen<UpdateSnapshot>('updates-changed', (event) => receive(event.payload))
      : () => {},
};
