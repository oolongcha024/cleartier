import { networkSeeds, testingSeeds } from './scenarios/networks.ts';
import { createNetworkConfig } from '../src/features/networks/defaults.ts';
import { createMemoryStorage, emptyDocument } from '../src/features/networks/persistence.ts';
import {
  createTelemetryStore,
  type TelemetrySnapshot,
} from '../src/features/networks/telemetry.ts';
import type {
  NetworkRuntime,
  RuntimeFrame,
  RuntimeSnapshot,
  RecoverySnapshot,
} from '../src/features/networks/runtime.ts';
import type { NetworkConfig, Peer } from '../src/features/networks/model.ts';

// Development and tests share one runtime simulation and the production contracts.
export function createMockNetworks(
  delay = () => new Promise<void>((resolve) => setTimeout(resolve, 300)),
  preset = 'default',
) {
  let disposed = false;
  const seeds =
    preset === 'testing' ? testingSeeds() : preset === 'empty' ? [] : structuredClone(networkSeeds);
  const hostname = preset === 'testing' ? 'actual-test-node' : 'ClearTier-PC';
  if (preset !== 'default' && preset !== 'testing')
    for (const seed of seeds) {
      seed.autoConnect = false;
      if (preset === 'offline') seed.running = false;
      if (preset === 'no-peers') seed.peers = [];
    }
  const control = {
    fail: preset === 'stale',
    failSave: false,
    noStableId: false,
    reads: 0,
    latency: 23.5,
    lossRate: 0.012,
    failNewConnections: false,
    operations: [] as string[],
    connections: [] as { action: string; id: string; config: NetworkConfig }[],
    recovery:
      preset === 'recovery'
        ? ({
            phase: 'waiting',
            attempt: 0,
            maxAttempts: 3,
            retryInSeconds: 2,
          } as RecoverySnapshot | null)
        : (null as RecoverySnapshot | null),
  };
  let seedingAt: number | null = null;
  const telemetry = createTelemetryStore(() => seedingAt ?? performance.now());
  const states = new Map<string, RuntimeSnapshot>();
  const candidates = new Map<string, NetworkConfig>();
  const generations = new Map<string, number>();
  const sessions = new Map<
    string,
    {
      at: number;
      elapsed: number;
      rx: number;
      tx: number;
      download: number;
      upload: number;
      peers: Peer[];
    }
  >();
  const document = emptyDocument();
  const epoch = 'mock-runtime';
  let sequence = 0;
  const stopped = (id: string, revision = 0): RuntimeSnapshot => ({
    id,
    revision,
    state: 'stopped',
    runningConfig: null,
    recoveryConfig: null,
    recovery: null,
    telemetry: null,
    deviceName: '',
    virtualIp: null,
    peerCount: 0,
    directPeerCount: 0,
    error: null,
  });
  for (const seed of seeds) {
    const config = createNetworkConfig(seed.id, {
      name: seed.name,
      secret: seed.secret,
      servers: [seed.server],
    });
    if (preset === 'testing') {
      config.hostname = hostname;
      config.tunName = `ct-${seed.name}`;
    }
    document.networks.push({
      id: seed.id,
      config,
      client: { alias: seed.alias, icon: seed.icon, autoConnect: seed.autoConnect, peerIcons: {} },
    });
    const snapshot = stopped(seed.id);
    if (seed.running) {
      snapshot.state = 'running';
      snapshot.runningConfig = config;
      snapshot.virtualIp = seed.ip;
      snapshot.deviceName = config.tunName;
      snapshot.peerCount = seed.peers.length;
      snapshot.directPeerCount = seed.peers.filter((peer) => peer.connection === 'direct').length;
      const at = performance.now();
      let rx = seed.downloadBytes - Math.floor(seed.download * 40),
        tx = seed.uploadBytes - Math.floor(seed.upload * 40);
      for (let i = 0; i <= 30; i++) {
        const factor = 0.65 + (0.35 * i) / 30 + Math.sin(i * 2) * 0.15;
        if (i) {
          rx += Math.floor(seed.download * factor * 2);
          tx += Math.floor(seed.upload * factor * 2);
        }
        seedingAt = at - 60_000 + i * 2000;
        snapshot.telemetry = {
          session: `demo-${seed.id}`,
          elapsedMs: i * 2000,
          hostname,
          peers: seed.peers,
          downloadBytes: String(rx),
          uploadBytes: String(tx),
          incomplete: false,
        };
        telemetry.receive(seed.id, snapshot.telemetry, 'running');
      }
      sessions.set(seed.id, {
        at,
        elapsed: 60_000,
        rx,
        tx,
        download: seed.download,
        upload: seed.upload,
        peers: seed.peers,
      });
    }
    states.set(seed.id, snapshot);
  }
  seedingAt = null;
  document.selectedId = seeds[0]?.id ?? '';
  if (preset === 'failed' || preset === 'starting') {
    const state = states.get(document.selectedId);
    if (state) {
      state.state = preset === 'failed' ? 'failed' : 'starting';
      state.runningConfig = null;
      state.virtualIp = null;
      state.telemetry = null;
      state.peerCount = 0;
      state.directPeerCount = 0;
      state.error = preset === 'failed' ? { code: 'tun_failed' } : null;
    }
  }
  const sample = (): RuntimeFrame => {
    if (disposed) throw { code: 'operation_cancelled' };
    for (const [id, session] of sessions) {
      const state = states.get(id)!;
      if (state.state !== 'running') continue;
      const elapsed = Math.floor(performance.now() - session.at);
      const previous = state.telemetry;
      state.telemetry = {
        session: previous?.session ?? `demo-session-${++sequence}`,
        elapsedMs: session.elapsed + elapsed,
        hostname: state.runningConfig?.hostname || hostname,
        peers: session.peers.map((peer, index) => ({
          ...peer,
          instanceId: control.noStableId ? null : peer.instanceId,
          ...(preset === 'testing' && index === 0
            ? { latency: control.latency, lossRate: control.lossRate }
            : {}),
        })),
        downloadBytes: String(session.rx + Math.floor((session.download * elapsed) / 1000)),
        uploadBytes: String(session.tx + Math.floor((session.upload * elapsed) / 1000)),
        incomplete: false,
      };
      state.revision++;
    }
    const frame: RuntimeFrame = structuredClone({
      epoch,
      health: 'ready',
      error: null,
      networks: [...states.values()],
    });
    if (control.recovery && frame.networks[0]) {
      const first = frame.networks[0];
      first.recoveryConfig = first.runningConfig;
      first.runningConfig = null;
      first.state = control.recovery.phase === 'starting' ? 'starting' : 'failed';
      first.recovery = structuredClone(control.recovery);
      first.error = { code: 'core_exited' };
    }
    return frame;
  };
  const start = async (id: string, config: NetworkConfig, restart: boolean) => {
    if (disposed) throw { code: 'operation_cancelled' };
    control.operations.push(restart ? 'restart' : 'start');
    control.recovery = null;
    if (control.failNewConnections && !seeds.some((seed) => seed.id === id)) {
      control.connections.push({
        action: restart ? 'restart' : 'start',
        id,
        config: structuredClone(config),
      });
      throw { code: 'tun_failed' };
    }
    const before = states.get(id);
    if (candidates.has(id)) throw { code: 'operation_busy' };
    if (!restart && before?.state === 'running') throw { code: 'instance_running' };
    const reserved = [...states]
      .flatMap(([otherId, state]) =>
        state.runningConfig ? [[otherId, state.runningConfig] as const] : [],
      )
      .concat([...candidates]);
    for (const [otherId, other] of reserved) {
      if (id === otherId) continue;
      if (other.name === config.name && other.secret === config.secret)
        throw { code: 'network_already_running' };
      if (config.tunName && other.tunName.toLowerCase() === config.tunName.toLowerCase())
        throw { code: 'tun_name_in_use' };
      if (
        config.ipv4Mode === 'manual' &&
        other.ipv4Mode === 'manual' &&
        other.ipv4Address === config.ipv4Address
      )
        throw { code: 'address_in_use' };
    }
    const generation = (generations.get(id) ?? 0) + 1;
    generations.set(id, generation);
    candidates.set(id, structuredClone(config));
    states.set(id, {
      ...stopped(id, (before?.revision ?? 0) + 1),
      state: 'starting',
      telemetry: before?.telemetry ?? null,
    });
    try {
      await delay();
    } catch (error) {
      if (generations.get(id) === generation) {
        candidates.delete(id);
        states.set(id, stopped(id, (states.get(id)?.revision ?? 0) + 1));
      }
      throw error;
    }
    if (disposed || generations.get(id) !== generation) throw { code: 'operation_cancelled' };
    candidates.delete(id);
    const seed = seeds.find((seed) => seed.id === id);
    const state = {
      ...stopped(id, (before?.revision ?? 0) + 1),
      state: 'running' as const,
      runningConfig: structuredClone(config),
      deviceName: config.tunName,
      virtualIp:
        config.ipv4Mode === 'manual'
          ? config.ipv4Address
          : config.ipv4Mode === 'none'
            ? null
            : (seed?.ip ?? '10.42.0.20'),
      peerCount: seed?.peers.length ?? 0,
      directPeerCount: seed?.peers.filter((peer) => peer.connection === 'direct').length ?? 0,
    };
    state.telemetry = {
      session: `demo-session-${++sequence}`,
      elapsedMs: 0,
      hostname: config.hostname || hostname,
      peers: seed?.peers ?? [],
      downloadBytes: '0',
      uploadBytes: '0',
      incomplete: false,
    } as TelemetrySnapshot;
    states.set(id, state);
    sessions.set(id, {
      at: performance.now(),
      elapsed: 0,
      rx: 0,
      tx: 0,
      download: seed?.download ?? 0,
      upload: seed?.upload ?? 0,
      peers: seed?.peers ?? [],
    });
    return sample();
  };
  const runtime: NetworkRuntime = {
    snapshot: async () => {
      control.reads++;
      if (control.fail) throw { code: 'request_timeout' };
      return sample();
    },
    start: (id, config) => start(id, config, false),
    restart: (id, config) => start(id, config, true),
    stop: async (id) => {
      control.operations.push('stop');
      control.recovery = null;
      generations.set(id, (generations.get(id) ?? 0) + 1);
      const before = states.get(id);
      states.set(id, {
        ...(before ?? stopped(id)),
        state: 'stopping',
        revision: (before?.revision ?? 0) + 1,
      });
      await delay();
      if (disposed) throw { code: 'operation_cancelled' };
      candidates.delete(id);
      const current = states.get(id);
      states.set(id, {
        ...stopped(id, (current?.revision ?? 0) + 1),
        telemetry: current?.telemetry ?? null,
      });
      return sample();
    },
    confirmQuiescent: async (id) => {
      control.operations.push('release');
      if (
        candidates.has(id) ||
        (states.has(id) && !['stopped', 'failed'].includes(states.get(id)!.state))
      )
        throw { code: 'instance_running' };
      return sample();
    },
  };
  const memory = createMemoryStorage(document);
  const storage = {
    ...memory,
    save: async (...args: Parameters<typeof memory.save>) => {
      if (control.failSave) throw { code: 'io' };
      return memory.save(...args);
    },
  };
  return {
    runtime,
    storage,
    telemetry,
    control,
    dispose: () => {
      disposed = true;
      for (const [id, generation] of generations) generations.set(id, generation + 1);
      candidates.clear();
    },
  };
}
