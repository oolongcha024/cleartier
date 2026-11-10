import packageInfo from '../package.json' with { type: 'json' };
import type { Platform, DesktopStatus, DiagnosticReport } from '../src/platform/contracts.ts';
import type { ConfigurationPreview } from '../src/features/networks/official-configuration.ts';
import type { NetworkConfig } from '../src/features/networks/model.ts';
import { createMockNetworks } from './mock-networks.ts';
import { createMockUpdates } from './mock-updates.ts';

/** All simulated effects remain in memory. Both the workbench and tests use this factory. */
export async function createMockPlatform(scene = 'default') {
  const [feature, preset] = scene.split('.');
  const networks = createMockNetworks(
    undefined,
    scene === 'testing' ? 'testing' : feature === 'networks' ? preset : 'default',
  );
  const updates = createMockUpdates(feature === 'updates' ? preset : 'idle');
  const desktopListeners = new Set<() => void>();
  const visibilityListeners = new Set<(visible: boolean) => void>();
  let sequence = 0;
  let disposed = false;
  const status: DesktopStatus = {
    preferences: {
      version: 1,
      closeBehavior: 'background',
      closeExplained: false,
      launchAtLogin: false,
      autoRecover: true,
    },
    preferenceError: null,
    autostartError: false,
    trayAvailable: true,
    pending: null,
    quitting: false,
    exitError: null,
  };
  const emit = () => {
    for (const receive of desktopListeners) receive();
  };
  const initial = await networks.runtime.snapshot().catch(() => null);
  const report: DiagnosticReport = {
    generatedAt: Math.floor(Date.now() / 1000),
    appVersion: packageInfo.version,
    coreVersion: '2.6.4-development',
    platform: 'windows',
    architecture: 'x86_64',
    configurationReadable: true,
    preferencesReadable: true,
    processLogsReadable: true,
    coreState: 'ready',
    coreError: null,
    snapshotError: null,
    networks: (initial?.networks ?? []).map((network, index) => ({
      number: index + 1,
      state: network.state,
      virtualAddressAssigned: Boolean(network.virtualIp),
      interfaceExpected: network.state === 'running',
      interfacePresent: network.state === 'running',
      peerCount: network.peerCount,
      directPeerCount: network.directPeerCount,
      error: network.error?.code ?? null,
    })),
    recentErrors: [{ time: 1794096000, code: 'core_exited' }],
  };
  const desktop = {
    status,
    report,
    emit,
    updates: [] as unknown[],
    responses: [] as { requestId: number; choice: string }[],
    failSave: false,
    failExport: false,
    cancelExport: false,
    failRespond: false,
    failRead: feature === 'diagnostics' && preset === 'failed',
    failLogs: false,
    holdRead: false,
    logs: 0,
    exports: 0,
    request: (kind: 'close' | 'exit') => {
      status.pending = { id: ++sequence, kind };
      emit();
    },
  };
  const visibility = {
    visible: true,
    minimized: false,
    emit: () => {
      for (const receive of visibilityListeners)
        receive(visibility.visible && !visibility.minimized);
    },
  };
  const client = {
    clientVersion: packageInfo.version,
    coreVersion: '2.6.4-8428a89d',
    failClient: false,
    failCore: false,
    failHost: false,
  };
  const configuration = {
    cancelPick: false,
    invalidPick: false,
    failExport: false,
    cancelExport: false,
    exports: [] as { id: string; config: NetworkConfig }[],
    picks: 0,
  };
  const invitations = {
    writes: [] as string[],
    parameters: [] as { id: string; config: NetworkConfig }[],
    failCopy: false,
    failParameters: false,
    connections: networks.control.connections,
  };
  const inspect = (id: string, config: NetworkConfig): ConfigurationPreview => ({
    id,
    config: structuredClone(config),
    issues: config.officialToml?.includes('future_flag')
      ? [{ path: 'flags.future_flag', code: 'unknown' }]
      : [],
    preservedFields: config.officialToml ? ['listeners', 'routes', 'flags.future_flag'] : [],
  });
  if (feature === 'diagnostics') {
    if (preset === 'issues') report.networks[0].interfacePresent = false;
    if (preset === 'incomplete') report.networks[0].interfacePresent = null;
    if (preset === 'idle') {
      report.networks = [];
      report.coreState = 'stopped';
    }
    if (preset === 'checking') desktop.holdRead = true;
  }
  if (feature === 'desktop') {
    if (preset === 'close' || preset === 'exit') desktop.request(preset);
    if (preset === 'preferences-error') status.preferenceError = 'invalid';
    if (preset === 'tray-unavailable') status.trayAvailable = false;
    if (preset === 'quitting') status.quitting = true;
  }
  const platform: Platform = {
    networks,
    updates: updates.adapter,
    client: {
      readHostEnvironment: async () =>
        client.failHost
          ? { hostname: '', platform: 'unknown', unavailable: true }
          : {
              hostname: scene === 'testing' ? 'actual-test-node' : 'ClearTier-PC',
              platform: 'windows',
            },
      readClientVersion: async () => {
        if (client.failClient) throw 'read';
        return client.clientVersion;
      },
      readCoreVersion: async () => {
        if (client.failCore) throw 'read';
        return client.coreVersion;
      },
    },
    desktop: {
      read: async () => structuredClone(status),
      update: async (update) => {
        desktop.updates.push(structuredClone(update));
        if (desktop.failSave) throw 'preferences';
        status.preferences = { ...status.preferences, ...update };
        emit();
        return structuredClone(status);
      },
      watch: async (refresh) => {
        desktopListeners.add(refresh);
        return () => {
          desktopListeners.delete(refresh);
        };
      },
      exit: async () => {
        desktop.request('exit');
      },
      respond: async (requestId, choice) => {
        if (desktop.failRespond) throw 'io';
        if (status.pending?.id !== requestId) throw 'stale';
        desktop.responses.push({ requestId, choice });
        if (choice === 'background') status.preferences.closeExplained = true;
        if (choice === 'exit' && status.pending.kind === 'close') {
          desktop.request('exit');
          return;
        }
        status.pending = null;
        emit();
      },
      readDiagnostics: async () => {
        while (desktop.holdRead && !disposed)
          await new Promise((resolve) => setTimeout(resolve, 20));
        if (disposed || desktop.failRead) throw 'io';
        if (scene !== 'testing' && feature !== 'diagnostics') {
          const frame = await networks.runtime.snapshot().catch(() => null);
          report.generatedAt = Math.floor(Date.now() / 1000);
          report.snapshotError = frame ? null : 'request_timeout';
          if (frame) {
            report.coreState = frame.networks.some((network) => network.state !== 'stopped')
              ? 'ready'
              : 'stopped';
            report.networks = frame.networks.map((network, index) => ({
              number: index + 1,
              state: network.state,
              virtualAddressAssigned: Boolean(network.virtualIp),
              interfaceExpected: network.state === 'running',
              interfacePresent: network.state === 'running',
              peerCount: network.peerCount,
              directPeerCount: network.directPeerCount,
              error: network.error?.code ?? null,
            }));
          }
        }
        return structuredClone(report);
      },
      exportDiagnostics: async () => {
        if (desktop.failExport) throw 'io';
        if (desktop.cancelExport) return false;
        desktop.exports++;
        return true;
      },
      openLogs: async () => {
        if (desktop.failLogs) throw 'io';
        desktop.logs++;
      },
    },
    officialConfiguration: {
      inspect: async (id, config) => inspect(id, config),
      pick: async () => {
        if (configuration.cancelPick) return null;
        if (configuration.invalidPick) throw 'invalid';
        const base = (await networks.storage.load()).networks[0]?.config;
        if (!base) throw 'invalid';
        return inspect(
          `33333333-3333-4333-8333-${String(++configuration.picks).padStart(12, '0')}`,
          {
            ...base,
            hostname: 'migrated-node',
            ipv4Mode: 'manual',
            ipv4Address: '10.77.0.8',
            ipv4Prefix: 24,
            officialToml:
              'hostname = "migrated-node"\nlisteners = ["tcp://0.0.0.0:11010"]\nroutes = ["192.168.8.0/24"]\n[flags]\nfuture_flag = true\n',
          },
        );
      },
      export: async (id, config) => {
        if (configuration.failExport) throw 'io';
        if (configuration.cancelExport) return false;
        configuration.exports.push({ id, config: structuredClone(config) });
        return true;
      },
    },
    readJoinParameters: async (id, config) => {
      invitations.parameters.push({ id, config: structuredClone(config) });
      if (invitations.failParameters) throw 'unsupportedConfiguration';
      return { name: config.name, secret: config.secret, servers: [...config.servers] };
    },
    writeClipboard: async (value) => {
      if (invitations.failCopy) throw 'clipboard-denied';
      invitations.writes.push(value);
    },
    watchWindowVisibility: (receive) => {
      visibilityListeners.add(receive);
      receive(visibility.visible && !visibility.minimized);
      return () => {
        visibilityListeners.delete(receive);
      };
    },
  };
  return {
    platform,
    controls: {
      networks: networks.control,
      updates: updates.control,
      desktop,
      visibility,
      client,
      configuration,
      invitations,
    },
    dispose: () => {
      disposed = true;
      networks.dispose();
      updates.dispose();
      desktopListeners.clear();
      visibilityListeners.clear();
    },
  };
}
