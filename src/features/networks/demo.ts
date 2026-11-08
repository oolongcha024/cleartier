import { createNetworkConfig } from './defaults.ts';
import { createMemoryStorage, emptyDocument } from './persistence.ts';
import { createTelemetryStore, type TelemetrySnapshot } from './telemetry.ts';
import type { NetworkRuntime, RuntimeFrame, RuntimeSnapshot } from './runtime.ts';
import type { NetworkConfig, Peer } from './model.ts';

const seeds = [
  {
    id: 'office',
    alias: '远程办公室',
    icon: 'work' as const,
    name: 'studio-work',
    secret: 'demo-office-key',
    server: 'tcp://office.example.com:11010',
    ip: '10.42.0.8',
    autoConnect: true,
    running: true,
    download: 2.4 * 1024 ** 2,
    upload: 0.128 * 1024 ** 2,
    downloadBytes: 2_000_000_000,
    uploadBytes: 134_217_728,
    peers: [
      {
        id: 'nas',
        instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1',
        publicServer: true,
        name: 'Studio NAS',
        ip: '10.42.0.1',
        connection: 'direct',
        latency: 12,
        lossRate: 0,
        protocols: ['TCP'],
        version: '2.6.4',
      },
      {
        id: 'mac',
        instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2',
        name: 'MacBook Pro',
        ip: '10.42.0.3',
        connection: 'direct',
        latency: 18,
        lossRate: 0.003,
        protocols: ['UDP'],
        version: '2.6.4',
      },
      {
        id: 'pc',
        instanceId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3',
        name: '办公室 PC',
        ip: '10.42.0.12',
        connection: 'relay',
        latency: null,
        lossRate: null,
        nextHop: 'Studio NAS',
        version: '2.6.4',
      },
    ] as Peer[],
  },
  {
    id: 'gaming',
    alias: '周末联机',
    icon: 'sports_esports' as const,
    name: 'weekend-party',
    secret: 'demo-game-key',
    server: 'udp://game.example.com:11010',
    ip: '10.56.0.2',
    autoConnect: false,
    running: true,
    download: 0.86 * 1024 ** 2,
    upload: 0.096 * 1024 ** 2,
    downloadBytes: 478_150_656,
    uploadBytes: 83_886_080,
    peers: [
      {
        id: 'player1',
        instanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1',
        name: 'Alex 的电脑',
        ip: '10.56.0.3',
        connection: 'direct',
        latency: 24,
        lossRate: 0.012,
        protocols: ['UDP'],
        version: '2.6.4',
      },
      {
        id: 'player2',
        instanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb2',
        name: 'Pixel Station',
        ip: '10.56.0.5',
        connection: 'direct',
        latency: 28,
        lossRate: 0,
        protocols: ['UDP'],
        version: '2.6.4',
      },
    ] as Peer[],
  },
  {
    id: 'home',
    alias: '家里的小网络',
    icon: 'home' as const,
    name: 'home-lab',
    secret: '',
    server: 'tcp://home.example.com:11010',
    ip: '10.68.0.6',
    autoConnect: false,
    running: false,
    download: 0.32 * 1024 ** 2,
    upload: 0.064 * 1024 ** 2,
    downloadBytes: 0,
    uploadBytes: 0,
    peers: [
      {
        id: 'home-nas',
        instanceId: 'cccccccc-cccc-4ccc-8ccc-ccccccccccc1',
        name: 'Home Server',
        ip: '10.68.0.1',
        connection: 'direct',
        latency: 8,
      },
    ] as Peer[],
  },
];

// Fixture knowledge, including historical samples, stays inside the browser
// adapter. Callers observe the same lifecycle and telemetry as on desktop.
export function createDemoEnvironment(
  delay = () => new Promise<void>((resolve) => setTimeout(resolve, 900)),
) {
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
  const epoch = 'browser-demo';
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
          hostname: 'ClearTier-PC',
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
  document.selectedId = seeds[0].id;
  const sample = (): RuntimeFrame => {
    for (const [id, session] of sessions) {
      const state = states.get(id)!;
      if (state.state !== 'running') continue;
      const elapsed = Math.floor(performance.now() - session.at);
      const previous = state.telemetry;
      state.telemetry = {
        session: previous?.session ?? `demo-session-${++sequence}`,
        elapsedMs: session.elapsed + elapsed,
        hostname: state.runningConfig?.hostname || 'ClearTier-PC',
        peers: session.peers,
        downloadBytes: String(session.rx + Math.floor((session.download * elapsed) / 1000)),
        uploadBytes: String(session.tx + Math.floor((session.upload * elapsed) / 1000)),
        incomplete: false,
      };
      state.revision++;
    }
    return structuredClone({ epoch, health: 'ready', error: null, networks: [...states.values()] });
  };
  const start = async (id: string, config: NetworkConfig, restart: boolean) => {
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
    if (generations.get(id) !== generation) throw { code: 'operation_cancelled' };
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
      hostname: config.hostname || 'ClearTier-PC',
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
    snapshot: async () => sample(),
    start: (id, config) => start(id, config, false),
    restart: (id, config) => start(id, config, true),
    stop: async (id) => {
      generations.set(id, (generations.get(id) ?? 0) + 1);
      const before = states.get(id);
      states.set(id, {
        ...(before ?? stopped(id)),
        state: 'stopping',
        revision: (before?.revision ?? 0) + 1,
      });
      await delay();
      candidates.delete(id);
      const current = states.get(id);
      states.set(id, {
        ...stopped(id, (current?.revision ?? 0) + 1),
        telemetry: current?.telemetry ?? null,
      });
      return sample();
    },
    confirmQuiescent: async (id) => {
      if (
        candidates.has(id) ||
        (states.has(id) && !['stopped', 'failed'].includes(states.get(id)!.state))
      )
        throw { code: 'instance_running' };
      return sample();
    },
  };
  return { runtime, storage: createMemoryStorage(document), telemetry };
}
