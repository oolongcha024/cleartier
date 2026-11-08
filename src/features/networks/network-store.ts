import { createStore } from 'zustand/vanilla';
import {
  configsEqual,
  draftConfig,
  hasPendingConfig,
  validateDraft,
  type DraftErrors,
  type NetworkDraft,
} from './configuration.ts';
import { createNetworkConfig, defaultTunName, newNetworkId } from './defaults.ts';
import { canRemove, sessionConfig, type Network, type NetworkConfig } from './model.ts';
import {
  documentFromNetworks,
  emptyDocument,
  networksFromDocument,
  offlineNetwork,
  storageFailure,
  type ConfigurationStorage,
  type StorageFailure,
} from './persistence.ts';
import { runtimeFailure, type NetworkRuntime, type RuntimeFrame } from './runtime.ts';
import { createTelemetryStore, type TelemetryStore } from './telemetry.ts';
import { peerIconKey, peerIconKinds, type PeerIconChoice } from './peer-icons.ts';

export type SaveMode = 'confirm' | 'later' | 'now';
export type TaskFailure = {
  status:
    | 'missing'
    | 'busy'
    | 'not-ready'
    | 'unsupported'
    | 'stale'
    | 'in-use'
    | 'conflict'
    | 'storage-error'
    | 'runtime-error';
};
export type TaskResult = { status: 'completed' } | TaskFailure;
export const completed = (result: TaskResult) => result.status === 'completed';
export type SaveResult =
  | Exclude<TaskResult, { status: 'completed' }>
  | { status: 'confirmation-required' }
  | { status: 'invalid'; errors: DraftErrors }
  | { status: 'saved'; pending: boolean }
  | { status: 'applying'; completion: Promise<TaskResult> };

export interface NetworkStore {
  networks: Network[];
  selectedId: string;
  phase: 'loading' | 'ready' | 'error';
  writing: boolean;
  autoConnecting: boolean;
  autoConnectCancelled: boolean;
  storageError: StorageFailure | null;
  initialize(): Promise<TaskResult>;
  reload(): Promise<TaskResult>;
  restore(): Promise<TaskResult>;
  refreshRuntime(): Promise<TaskResult>;
  dismissAutoConnectNotice(): void;
  clearStorageError(): void;
  selectNetwork(id: string): Promise<TaskResult>;
  setAutoConnect(id: string, enabled: boolean): Promise<TaskResult>;
  setPeerIcon(id: string, instanceId: string, choice: PeerIconChoice): Promise<TaskResult>;
  connect(id: string): Promise<TaskResult>;
  disconnect(id: string): Promise<TaskResult>;
  reconnect(id: string): Promise<TaskResult>;
  create(id: string, draft: NetworkDraft): Promise<SaveResult>;
  save(id: string, draft: NetworkDraft, mode?: SaveMode): Promise<SaveResult>;
  remove(id: string): Promise<TaskResult>;
  importConfiguration(id: string, config: NetworkConfig, alias: string): Promise<TaskResult>;
}

// One workflow owns durable mutations AND runtime intentions. Its internal
// reservations are acquired before yielding, including while writes are queued.
export function createNetworkStore(
  runtime: NetworkRuntime,
  options: {
    storage: ConfigurationStorage;
    telemetry?: TelemetryStore;
  },
) {
  const telemetry = options.telemetry ?? createTelemetryStore();
  const store = createStore<NetworkStore>()((set, get) => {
    let document = emptyDocument();
    let queue = Promise.resolve();
    let queuedWrites = 0;
    let initialization: Promise<TaskResult> | undefined;
    let initialized = false,
      loading = false,
      autoStarted = false,
      startupPending = false,
      runtimeReady = false;
    let refreshing: Promise<TaskResult> | undefined;
    let epoch = '';
    const retiredEpochs = new Set<string>();
    const revisions = new Map<string, number>();
    const generations = new Map<string, number>();
    const active = new Set<string>();
    const manuallyChanged = new Set<string>();
    const localErrors = new Map<string, { code: string }>();
    const update = (id: string, change: (network: Network) => Network) =>
      set((state) => {
        const current = state.networks.find((network) => network.id === id);
        if (!current) return state;
        const next = change(current);
        return next === current
          ? state
          : { networks: state.networks.map((network) => (network.id === id ? next : network)) };
      });
    const unavailable = (error: unknown, generation: Map<string, number>, target?: string) => {
      for (const network of get().networks) {
        if (
          network.id !== target &&
          (active.has(network.id) || generations.get(network.id) !== generation.get(network.id))
        )
          continue;
        telemetry.stale(network.id);
        update(network.id, (current) => ({
          ...current,
          coreState: 'unknown',
          connectionError: runtimeFailure(error),
        }));
      }
    };
    const receive = (frame: RuntimeFrame, generation: Map<string, number>, target?: string) => {
      if (retiredEpochs.has(frame.epoch)) return;
      if (epoch !== frame.epoch) {
        if (epoch) retiredEpochs.add(epoch);
        epoch = frame.epoch;
        revisions.clear();
      }
      if (frame.health !== 'ready') {
        runtimeReady = false;
        unavailable(frame.error, generation, target);
        return;
      }
      runtimeReady = true;
      // An externally removed durable profile must remain stoppable. Runtime facts
      // never become a new durable record merely because they were observed.
      for (const snapshot of frame.networks) {
        if (
          snapshot.id !== target &&
          (active.has(snapshot.id) || generations.get(snapshot.id) !== generation.get(snapshot.id))
        )
          continue;
        if (
          !get().networks.some((network) => network.id === snapshot.id) &&
          (snapshot.runningConfig ||
            snapshot.recoveryConfig ||
            ['running', 'starting', 'stopping'].includes(snapshot.state))
        ) {
          const network = offlineNetwork(
            snapshot.id,
            snapshot.runningConfig ?? snapshot.recoveryConfig ?? undefined,
          );
          set((state) => ({
            networks: [
              ...state.networks,
              {
                ...network,
                persisted: false,
                alias: snapshot.runningConfig?.name || snapshot.deviceName || snapshot.id,
              },
            ],
          }));
        }
      }
      for (const network of get().networks) {
        if (
          network.id !== target &&
          (active.has(network.id) || generations.get(network.id) !== generation.get(network.id))
        )
          continue;
        const snapshot = frame.networks.find((item) => item.id === network.id);
        const revision = snapshot?.revision ?? 0;
        if (revision < (revisions.get(network.id) ?? 0)) continue;
        revisions.set(network.id, revision);
        telemetry.receive(network.id, snapshot?.telemetry, snapshot?.state ?? 'stopped');
        update(network.id, (current) => {
          const change = {
            recovery: snapshot?.recovery ?? null,
            recoveryConfig: snapshot?.recoveryConfig ?? null,
            coreState: snapshot?.state ?? 'stopped',
            runningConfig: snapshot?.runningConfig ?? null,
            deviceName: snapshot?.deviceName ?? '',
            virtualIp: snapshot?.virtualIp ?? '',
            peerCount: snapshot?.peerCount ?? 0,
            directPeerCount: snapshot?.directPeerCount ?? 0,
            connectionError: snapshot?.error ?? localErrors.get(network.id) ?? null,
          };
          const unchanged = Object.entries(change).every(([key, value]) => {
            if (key === 'runningConfig' || key === 'recoveryConfig') {
              const previous = current[key];
              return (
                previous === value ||
                Boolean(previous && value && configsEqual(previous, value as NetworkConfig))
              );
            }
            return JSON.stringify(value) === JSON.stringify(current[key as keyof Network]);
          });
          return unchanged ? current : { ...current, ...change };
        });
      }
    };
    const readRuntime = async (target?: string): Promise<TaskResult> => {
      const generation = new Map(generations);
      try {
        const frame = await runtime.snapshot();
        receive(frame, generation, target);
        if (runtimeReady && startupPending && !loading)
          queueMicrotask(() => {
            void autoConnect();
          });
        return { status: frame.health === 'ready' ? 'completed' : 'runtime-error' };
      } catch (error) {
        runtimeReady = false;
        unavailable(error, generation, target);
        return { status: 'runtime-error' };
      }
    };
    const reserve = (
      id: string,
      operation: Network['operation'],
      creating = false,
    ): TaskFailure | null => {
      if (loading || get().phase !== 'ready') return { status: 'not-ready' };
      const network = get().networks.find((item) => item.id === id);
      if (!network && !creating) return { status: 'missing' };
      if (active.has(id) || (creating && network)) return { status: 'busy' };
      active.add(id);
      generations.set(id, (generations.get(id) ?? 0) + 1);
      update(id, (current) => ({ ...current, operation }));
      return null;
    };
    const release = (id: string) => {
      active.delete(id);
      generations.set(id, (generations.get(id) ?? 0) + 1);
      update(id, (current) =>
        current.operation === null ? current : { ...current, operation: null },
      );
    };
    const commit = (
      change: () => { networks: Network[]; selectedId: string } | TaskResult,
    ): Promise<TaskResult> => {
      queuedWrites++;
      set({ writing: true });
      const operation = queue
        .then(async (): Promise<TaskResult> => {
          const next = change();
          if ('status' in next) return next;
          const removed = new Set(
            get()
              .networks.filter((network) => !next.networks.some((item) => item.id === network.id))
              .map((network) => network.id),
          );
          try {
            document = await options.storage.save(
              documentFromNetworks(document, next.networks, next.selectedId),
              document.revision,
            );
            set((state) => ({
              selectedId: next.selectedId,
              storageError: null,
              networks: [
                ...next.networks.map((network) => {
                  const latest = state.networks.find((item) => item.id === network.id);
                  return latest
                    ? {
                        ...latest,
                        alias: network.alias,
                        icon: network.icon,
                        savedConfig: network.savedConfig,
                        editRevision: network.editRevision,
                        persisted: network.persisted,
                        autoConnect: network.autoConnect,
                        peerIcons: network.peerIcons,
                      }
                    : network;
                }),
                ...state.networks.filter(
                  (network) =>
                    !network.persisted &&
                    !removed.has(network.id) &&
                    !next.networks.some((item) => item.id === network.id),
                ),
              ],
            }));
            return { status: 'completed' };
          } catch (error) {
            set({ storageError: storageFailure(error) });
            return { status: 'storage-error' };
          }
        })
        .finally(() => {
          queuedWrites--;
          set({ writing: queuedWrites > 0 });
        });
      queue = operation.then(
        () => {},
        () => {},
      );
      return operation;
    };
    const operate = async (
      id: string,
      action: 'start' | 'stop' | 'restart',
      config?: NetworkConfig,
    ): Promise<TaskResult> => {
      localErrors.delete(id);
      update(id, (current) => ({
        ...current,
        coreState: action === 'stop' ? 'stopping' : 'starting',
        connectionError: null,
      }));
      const generation = new Map(generations);
      try {
        const frame =
          action === 'stop'
            ? await runtime.stop(id)
            : action === 'start'
              ? await runtime.start(id, config!)
              : await runtime.restart(id, config!);
        receive(frame, generation, id);
        const current = get().networks.find((item) => item.id === id);
        return {
          status:
            current?.coreState === (action === 'stop' ? 'stopped' : 'running')
              ? 'completed'
              : 'runtime-error',
        };
      } catch (error) {
        const failure = runtimeFailure(error);
        localErrors.set(id, failure);
        await readRuntime(id);
        update(id, (current) => ({ ...current, connectionError: failure }));
        return { status: 'runtime-error' };
      }
    };
    const transition = async (
      id: string,
      action: 'start' | 'stop' | 'restart',
      automatic = false,
    ): Promise<TaskResult> => {
      if (!automatic) manuallyChanged.add(id);
      const rejected = reserve(
        id,
        action === 'stop' ? 'disconnecting' : action === 'start' ? 'connecting' : 'reconnecting',
      );
      if (rejected) return rejected;
      try {
        const network = get().networks.find((item) => item.id === id)!;
        if (network.coreState === 'unknown') return { status: 'not-ready' };
        if (
          action !== 'stop' &&
          (['starting', 'stopping'].includes(network.coreState) ||
            (action === 'start' && (network.coreState === 'running' || sessionConfig(network))))
        )
          return { status: 'in-use' };
        if (action === 'restart' && !['running', 'failed'].includes(network.coreState))
          return { status: 'in-use' };
        return await operate(id, action, structuredClone(network.savedConfig));
      } finally {
        release(id);
      }
    };
    const autoConnect = async () => {
      if (autoStarted || !runtimeReady) return;
      autoStarted = true;
      startupPending = false;
      set({ autoConnecting: true, autoConnectCancelled: false });
      try {
        const ids = get()
          .networks.filter((network) => network.persisted && network.autoConnect)
          .map((network) => network.id);
        for (const id of ids) {
          const network = get().networks.find((item) => item.id === id);
          if (
            !network?.autoConnect ||
            manuallyChanged.has(id) ||
            sessionConfig(network) ||
            !['stopped', 'failed'].includes(network.coreState)
          )
            continue;
          const result = await transition(id, 'start', true);
          if (
            !completed(result) &&
            get().networks.find((item) => item.id === id)?.connectionError?.code ===
              'elevation_cancelled'
          ) {
            set({ autoConnectCancelled: true });
            break;
          }
        }
      } finally {
        set({ autoConnecting: false });
      }
    };
    const load = async (restore: boolean, startup: boolean): Promise<TaskResult> => {
      if (loading || active.size || queuedWrites) return { status: 'busy' };
      loading = true;
      set({ phase: 'loading', storageError: null });
      try {
        const next = await (restore ? options.storage.restore() : options.storage.load());
        const saved = networksFromDocument(next).map((network) => {
          const previous = get().networks.find((item) => item.id === network.id);
          if (!previous) return network;
          const changed =
            !configsEqual(network.savedConfig, previous.savedConfig) ||
            network.alias !== previous.alias ||
            network.icon !== previous.icon;
          return {
            ...previous,
            ...network,
            editRevision: previous.editRevision + Number(changed),
            coreState: previous.coreState,
            runningConfig: previous.runningConfig,
            recoveryConfig: previous.recoveryConfig,
            recovery: previous.recovery,
            deviceName: previous.deviceName,
            virtualIp: previous.virtualIp,
            peerCount: previous.peerCount,
            directPeerCount: previous.directPeerCount,
            connectionError: previous.connectionError,
          };
        });
        const unlisted = get()
          .networks.filter(
            (network) => !saved.some((item) => item.id === network.id) && !canRemove(network),
          )
          .map((network) => ({ ...network, persisted: false }));
        const networks = [...saved, ...unlisted];
        document = next;
        const selectedId = networks.some((network) => network.id === next.selectedId)
          ? next.selectedId
          : (networks[0]?.id ?? '');
        set({ networks, selectedId });
        if (startup) startupPending = true;
        await readRuntime();
        set({ phase: 'ready' });
      } catch (error) {
        set({ phase: 'error', storageError: storageFailure(error) });
        return { status: 'storage-error' };
      } finally {
        loading = false;
      }
      if (startup) void autoConnect();
      return { status: 'completed' };
    };
    const save = async (
      id: string,
      draft: NetworkDraft,
      mode: SaveMode,
      creating: boolean,
    ): Promise<SaveResult> => {
      const rejected = reserve(id, 'saving', creating);
      if (rejected) return rejected;
      let applying = false;
      try {
        const network = get().networks.find((item) => item.id === id);
        if (network && !network.persisted) return { status: 'unsupported' };
        if (network && draft.baseRevision !== network.editRevision) return { status: 'stale' };
        if (network && ['starting', 'stopping'].includes(network.coreState))
          return { status: 'busy' };
        const errors = validateDraft(
          draft,
          get()
            .networks.filter((item) => item.id !== id)
            .map((item) => item.savedConfig.tunName),
          network?.savedConfig,
        );
        if (Object.keys(errors).length) return { status: 'invalid', errors };
        const config = draftConfig(
          draft,
          network?.savedConfig ??
            createNetworkConfig(id, { name: draft.name, secret: draft.secret, servers: [] }),
        );
        const localOnly =
          network &&
          (draft.alias !== network.alias || draft.icon !== network.icon) &&
          configsEqual(config, network.savedConfig);
        const requiresReconnect =
          network?.coreState === 'running' &&
          network.runningConfig !== null &&
          !localOnly &&
          !configsEqual(config, network.runningConfig);
        if (mode === 'confirm' && requiresReconnect) return { status: 'confirmation-required' };
        const result = await commit(() => {
          const current = get().networks.find((item) => item.id === id);
          if (!creating && (!current || current.editRevision !== draft.baseRevision))
            return { status: 'stale' };
          if (
            config.tunName &&
            get().networks.some(
              (item) =>
                item.id !== id &&
                item.savedConfig.tunName.toLowerCase() === config.tunName.toLowerCase(),
            )
          )
            return { status: 'conflict' };
          const updated = {
            ...(current ?? offlineNetwork(id, config)),
            alias: draft.alias.trim() || draft.name,
            icon: draft.icon,
            savedConfig: structuredClone(config),
            editRevision: (current?.editRevision ?? 0) + 1,
          };
          return {
            networks: creating
              ? [...get().networks, updated]
              : get().networks.map((item) => (item.id === id ? updated : item)),
            selectedId: creating ? id : get().selectedId,
          };
        });
        if (!completed(result)) return result as Exclude<TaskResult, { status: 'completed' }>;
        if (mode === 'now' && requiresReconnect) {
          applying = true;
          update(id, (current) => ({ ...current, operation: 'reconnecting' }));
          return {
            status: 'applying',
            completion: operate(id, 'restart', structuredClone(config)).finally(() => release(id)),
          };
        }
        return {
          status: 'saved',
          pending: hasPendingConfig(get().networks.find((item) => item.id === id)!),
        };
      } finally {
        if (!applying) release(id);
      }
    };
    return {
      networks: [],
      selectedId: '',
      phase: 'loading',
      writing: false,
      storageError: null,
      autoConnecting: false,
      autoConnectCancelled: false,
      initialize: () => {
        if (initialization) return initialization;
        if (initialized)
          return Promise.resolve({
            status: get().phase === 'ready' ? 'completed' : 'storage-error',
          });
        initialized = true;
        initialization = load(false, true).finally(() => {
          initialization = undefined;
        });
        return initialization;
      },
      reload: () => load(false, false),
      restore: () => load(true, false),
      refreshRuntime: () => {
        refreshing ??= readRuntime().finally(() => {
          refreshing = undefined;
        });
        return refreshing;
      },
      dismissAutoConnectNotice: () => set({ autoConnectCancelled: false }),
      clearStorageError: () => set({ storageError: null }),
      selectNetwork: (id) =>
        get().phase !== 'ready'
          ? Promise.resolve({ status: 'not-ready' })
          : commit(() => {
              if (!get().networks.some((network) => network.id === id))
                return { status: 'missing' };
              return { networks: get().networks, selectedId: id };
            }),
      setAutoConnect: (id, autoConnect) =>
        get().phase !== 'ready'
          ? Promise.resolve({ status: 'not-ready' })
          : commit(() => {
              if (!get().networks.some((network) => network.id === id && network.persisted))
                return { status: 'missing' };
              return {
                networks: get().networks.map((network) =>
                  network.id === id ? { ...network, autoConnect } : network,
                ),
                selectedId: get().selectedId,
              };
            }),
      setPeerIcon: (id, instanceId, choice) =>
        get().phase !== 'ready'
          ? Promise.resolve({ status: 'not-ready' })
          : commit(() => {
              const network = get().networks.find(
                (network) => network.id === id && network.persisted,
              );
              const key = peerIconKey({ instanceId });
              if (!network || !key || (choice !== 'auto' && !peerIconKinds.includes(choice)))
                return { status: 'missing' };
              const peerIcons = { ...network.peerIcons };
              if (choice === 'auto') delete peerIcons[key];
              else peerIcons[key] = choice;
              return {
                networks: get().networks.map((item) =>
                  item.id === id ? { ...item, peerIcons } : item,
                ),
                selectedId: get().selectedId,
              };
            }),
      connect: (id) => transition(id, 'start'),
      disconnect: (id) => transition(id, 'stop'),
      reconnect: (id) => transition(id, 'restart'),
      create: (id, draft) => save(id, draft, 'confirm', true),
      save: (id, draft, mode = 'confirm') => save(id, draft, mode, false),
      importConfiguration: async (id, config, alias) => {
        const rejected = reserve(id, 'saving', true);
        if (rejected) return rejected;
        try {
          return await commit(() => {
            if (
              config.tunName &&
              get().networks.some(
                (item) => item.savedConfig.tunName.toLowerCase() === config.tunName.toLowerCase(),
              )
            )
              return { status: 'conflict' };
            const network = {
              ...offlineNetwork(id, structuredClone(config)),
              alias: alias.trim() || config.name,
            };
            return { networks: [...get().networks, network], selectedId: id };
          });
        } finally {
          release(id);
        }
      },
      remove: async (id) => {
        const network = get().networks.find((item) => item.id === id);
        if (!network) return { status: 'missing' };
        if (!canRemove(network)) return { status: 'in-use' };
        const rejected = reserve(id, 'removing');
        if (rejected) return rejected;
        try {
          const generation = new Map(generations);
          try {
            const frame = await runtime.confirmQuiescent(id);
            receive(frame, generation, id);
            const current = get().networks.find((item) => item.id === id)!;
            if (
              frame.health !== 'ready' ||
              !['stopped', 'failed'].includes(current.coreState) ||
              sessionConfig(current)
            )
              return { status: 'in-use' };
          } catch (error) {
            await readRuntime(id);
            update(id, (current) => ({ ...current, connectionError: runtimeFailure(error) }));
            return { status: 'in-use' };
          }
          const result = await commit(() => {
            const networks = get().networks.filter((item) => item.id !== id);
            return {
              networks,
              selectedId: get().selectedId === id ? (networks[0]?.id ?? '') : get().selectedId,
            };
          });
          if (completed(result)) {
            telemetry.remove(id);
            revisions.delete(id);
            localErrors.delete(id);
          }
          return result;
        } finally {
          release(id);
        }
      },
    };
  });
  return Object.assign(store, { telemetry });
}

export function newNetworkDraft(networks: Network[], id = newNetworkId()): Network {
  const network = offlineNetwork(id);
  network.savedConfig.tunName = defaultTunName(
    id,
    networks.map((network) => network.savedConfig.tunName),
  );
  return network;
}
