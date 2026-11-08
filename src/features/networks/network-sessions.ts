import { isBusy, type Network } from './model.ts';
import { runtimeFailure, type NetworkRuntime, type RuntimeSnapshot, type RuntimeFailure } from './runtime.ts';

// Session ordering lives here, independently from persistence and UI lifetimes.
// Command results and periodic reads cross the same snapshot seam. Generations
// keep a delayed read from undoing a newer user action.
export function createNetworkSessions(runtime: NetworkRuntime, access: {
  read: () => Network[];
  update: (id: string, change: (network: Network) => Network) => void;
  automatic: (running: boolean, cancelled: boolean) => void;
}) {
  const active = new Set<string>();
  const generations = new Map<string, number>();
  const manuallyChanged = new Set<string>();
  const localErrors = new Map<string, RuntimeFailure>();
  let refreshing: Promise<boolean> | undefined;
  let autoStarted = false;
  const apply = (snapshots: RuntimeSnapshot[], generation: Map<string, number>, target?: string) => {
    for (const network of access.read()) {
      if (network.id !== target && (active.has(network.id) || generations.get(network.id) !== generation.get(network.id))) continue;
      const snapshot = snapshots.find((snapshot) => snapshot.id === network.id);
      access.update(network.id, (current) => ({ ...current,
        coreState: snapshot?.state ?? 'stopped', runningConfig: snapshot?.runningConfig ?? null,
        deviceName: snapshot?.deviceName ?? '', virtualIp: snapshot?.virtualIp ?? '',
        peerCount: snapshot?.peerCount ?? 0, directPeerCount: snapshot?.directPeerCount ?? 0,
        connectionError: snapshot?.error ?? localErrors.get(network.id) ?? null,
      }));
    }
  };
  const readSnapshot = async (target?: string) => {
    if (!runtime.snapshot) return true;
    const generation = new Map(generations);
    try { apply(await runtime.snapshot(), generation, target); return true; }
    catch (error) {
      for (const network of access.read()) {
        if (network.id !== target && (active.has(network.id) || generations.get(network.id) !== generation.get(network.id))) continue;
        access.update(network.id, (current) => ({ ...current, coreState: 'unknown', connectionError: runtimeFailure(error) }));
      }
      return false;
    }
  };
  const transition = async (id: string, restart = false, automatic = false): Promise<boolean> => {
    if (!automatic) manuallyChanged.add(id);
    const network = access.read().find((item) => item.id === id);
    if (!network || active.has(id) || isBusy(network) || network.coreState === 'unknown'
      || (restart && network.coreState !== 'running' && network.coreState !== 'failed')) return false;
    const connecting = restart || network.coreState === 'stopped' || (network.coreState === 'failed' && network.runningConfig === null);
    const config = structuredClone(network.savedConfig);
    if (connecting) {
      const duplicate = access.read().find((other) => other.id !== id
        && (other.coreState === 'running' || other.coreState === 'starting' || other.coreState === 'stopping')
        && (other.runningConfig ?? other.savedConfig).name === config.name
        && (other.runningConfig ?? other.savedConfig).secret === config.secret);
      if (duplicate) {
        localErrors.set(id, { code: 'network_already_running' });
        access.update(id, (current) => ({ ...current, connectionError: { code: 'network_already_running' } }));
        return false;
      }
    }
    active.add(id); generations.set(id, (generations.get(id) ?? 0) + 1);
    localErrors.delete(id);
    access.update(id, (current) => ({ ...current, coreState: connecting ? 'starting' : 'stopping', connectionError: null,
      trafficTotals: connecting ? null : current.trafficTotals }));
    try {
      const generation = new Map(generations);
      const result = await runtime(connecting ? { action: restart ? 'restart' : 'start', id, config } : { action: 'stop', id });
      if (Array.isArray(result)) apply(result, generation, id);
      else if (runtime.snapshot) await readSnapshot(id);
      else access.update(id, (current) => ({ ...current, coreState: connecting ? 'running' : 'stopped',
        runningConfig: connecting ? config : null,
        trafficTotals: connecting ? { downloadBytes: 0, uploadBytes: 0 } : current.trafficTotals }));
      const current = access.read().find((item) => item.id === id);
      return current?.coreState === (connecting ? 'running' : 'stopped');
    } catch (error) {
      const failure = runtimeFailure(error);
      localErrors.set(id, failure);
      if (runtime.snapshot) await readSnapshot(id);
      else access.update(id, (current) => ({ ...current, coreState: 'failed', runningConfig: null }));
      access.update(id, (current) => ({ ...current, connectionError: failure }));
      return false;
    } finally { active.delete(id); }
  };
  return {
    toggle: (id: string) => transition(id),
    reconnect: (id: string) => transition(id, true),
    refresh: () => {
      if (!refreshing) refreshing = readSnapshot().finally(() => { refreshing = undefined; });
      return refreshing;
    },
    autoConnect: async () => {
      if (autoStarted || !runtime.snapshot) return;
      autoStarted = true;
      access.automatic(true, false);
      let cancelled = false;
      try {
        const ids = access.read().filter((network) => network.autoConnect).map((network) => network.id);
        for (const id of ids) {
          const network = access.read().find((network) => network.id === id);
          if (!network?.autoConnect || manuallyChanged.has(id) || !['stopped', 'failed'].includes(network.coreState)) continue;
          const connected = await transition(id, false, true);
          if (!connected && access.read().find((network) => network.id === id)?.connectionError?.code === 'elevation_cancelled') {
            cancelled = true; break;
          }
        }
      } finally { access.automatic(false, cancelled); }
    },
  };
}
