import type { ConfigurationStorage } from '../features/networks/persistence.ts';
import type { NetworkRuntime } from '../features/networks/runtime.ts';
import type { createTelemetryStore } from '../features/networks/telemetry.ts';
import type { OfficialConfiguration } from '../features/networks/official-configuration.ts';
import type { JoinParameters } from '../features/invitations/invitation.ts';
import type { NetworkConfig } from '../features/networks/model.ts';

export interface HostEnvironment {
  hostname: string;
  platform: 'windows' | 'linux' | 'macos' | 'unknown';
  unavailable?: boolean;
}

export interface UpdatePreferences {
  automatic: boolean;
  prereleases: boolean;
}
export interface UpdateSnapshot {
  revision: number;
  distribution: 'installed' | 'portable' | 'unsupported';
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
  generatedAt: number;
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

/** Selected once, before application stores are created. Native and development
 * adapters share data contracts, error modes and subscription cleanup. */
export interface Platform {
  networks: {
    runtime: NetworkRuntime;
    storage: ConfigurationStorage;
    telemetry?: ReturnType<typeof createTelemetryStore>;
  };
  client: {
    readHostEnvironment(): Promise<HostEnvironment>;
    readClientVersion(): Promise<string>;
    readCoreVersion(): Promise<string>;
  };
  updates: UpdateAdapter;
  desktop: {
    read(): Promise<DesktopStatus>;
    update(update: DesktopUpdate): Promise<DesktopStatus>;
    watch(refresh: () => void): Promise<() => void>;
    respond(requestId: number, choice: 'cancel' | 'background' | 'exit'): Promise<void>;
    exit(): Promise<void>;
    readDiagnostics(): Promise<DiagnosticReport>;
    exportDiagnostics(): Promise<boolean>;
    openLogs(): Promise<void>;
  };
  officialConfiguration: OfficialConfiguration;
  readJoinParameters(id: string, config: NetworkConfig): Promise<JoinParameters>;
  writeClipboard(value: string): Promise<void>;
  watchWindowVisibility(changed: (visible: boolean) => void): () => void;
}
