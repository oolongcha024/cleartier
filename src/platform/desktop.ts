import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { isDesktop } from './client';

export interface DesktopPreferences {
  version: number;
  closeBehavior: 'background' | 'exit';
  closeExplained: boolean;
  launchAtLogin: boolean;
  autoRecover: boolean;
}
export interface DesktopStatus {
  preferences: DesktopPreferences;
  preferenceError: string | null;
  autostartError: boolean;
  trayAvailable: boolean;
  pending: { id: number; kind: 'close' | 'exit' } | null;
  quitting: boolean;
  exitError: string | null;
}
export type DesktopUpdate = Pick<
  DesktopPreferences,
  'closeBehavior' | 'launchAtLogin' | 'autoRecover'
>;
export interface DiagnosticReport {
  appVersion: string;
  coreVersion: string;
  platform: string;
  architecture: string;
  configurationReadable: boolean;
  preferencesReadable: boolean;
  processLogsReadable: boolean;
  coreState: 'stopped' | 'starting' | 'ready' | 'failed';
  coreError: string | null;
  snapshotError: string | null;
  networks: {
    number: number;
    state: string;
    virtualAddressAssigned: boolean;
    interfaceExpected: boolean | null;
    interfacePresent: boolean | null;
    peerCount: number;
    directPeerCount: number;
    error: string | null;
  }[];
  recentErrors: { time: number; code: string }[];
}
const previewKey = 'cleartier-preview-desktop';
function previewStatus(): DesktopStatus {
  let stored: Partial<DesktopPreferences> = {};
  try {
    stored = JSON.parse(localStorage.getItem(previewKey) ?? '{}');
  } catch {
    /* Preview only. */
  }
  return {
    preferences: {
      version: 1,
      closeBehavior: stored.closeBehavior === 'exit' ? 'exit' : 'background',
      closeExplained: stored.closeExplained === true,
      launchAtLogin: stored.launchAtLogin === true,
      autoRecover: stored.autoRecover !== false,
    },
    preferenceError: null,
    autostartError: false,
    trayAvailable: true,
    pending: null,
    quitting: false,
    exitError: null,
  };
}
// Preview changes stay in a dedicated demo record and never touch OS startup.
export function readDesktop(): Promise<DesktopStatus> {
  return isDesktop() ? invoke('desktop_status') : Promise.resolve(previewStatus());
}
export async function updateDesktop(update: DesktopUpdate): Promise<DesktopStatus> {
  if (isDesktop()) return invoke('desktop_update', { update });
  const status = previewStatus();
  status.preferences = { ...status.preferences, ...update };
  localStorage.setItem(previewKey, JSON.stringify(status.preferences));
  return status;
}
export async function watchDesktop(refresh: () => void): Promise<() => void> {
  return isDesktop() ? listen('desktop-changed', refresh) : () => {};
}
export function respondDesktop(
  requestId: number,
  choice: 'cancel' | 'background' | 'exit',
): Promise<void> {
  return isDesktop() ? invoke('desktop_respond', { requestId, choice }) : Promise.resolve();
}
export function exitDesktop(): Promise<void> {
  return isDesktop() ? invoke('desktop_exit') : Promise.reject('desktopOnly');
}
export function readDiagnostics(): Promise<DiagnosticReport> {
  return isDesktop() ? invoke('diagnostics_read') : Promise.reject('desktopOnly');
}
export function exportDiagnostics(): Promise<boolean> {
  return isDesktop() ? invoke('diagnostics_export') : Promise.reject('desktopOnly');
}
export function openLogs(): Promise<void> {
  return isDesktop() ? invoke('logs_open') : Promise.reject('desktopOnly');
}
