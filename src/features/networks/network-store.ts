import { createStore } from 'zustand/vanilla';
import { configsEqual, draftConfig, hasPendingConfig, validateDraft, type DraftErrors, type NetworkDraft } from './configuration.ts';
import { createNetworkConfig, defaultTunName, newNetworkId } from './defaults.ts';
import { isBusy, type Network, type NetworkConfig } from './model.ts';
import { documentFromNetworks, emptyDocument, networksFromDocument, offlineNetwork, storageFailure, type ConfigurationStorage, type StorageFailure } from './persistence.ts';
import type { NetworkRuntime } from './runtime.ts';
import type { TelemetryStore } from './telemetry.ts';
import { peerIconKey, peerIconKinds, type PeerIconChoice } from './peer-icons.ts';
import { createNetworkSessions } from './network-sessions.ts';

export type SaveMode = 'confirm' | 'later' | 'now';
export type SaveResult =
  | { status: 'missing' | 'busy' | 'confirmation-required' | 'storage-error' | 'unsupported' }
  | { status: 'invalid'; errors: DraftErrors }
  | { status: 'saved'; pending: boolean }
  | { status: 'applying'; completion: Promise<boolean> };

export interface NetworkStore {
  networks: Network[]; selectedId: string;
  phase: 'loading' | 'ready' | 'error'; writing: boolean;
  autoConnecting: boolean; autoConnectCancelled: boolean;
  refreshRuntime: () => Promise<boolean>;
  dismissAutoConnectNotice: () => void;
  storageError: StorageFailure | null; connectionEnabled: boolean;
  initialize: (restore?: boolean) => Promise<void>;
  clearStorageError: () => void;
  selectNetwork: (id: string) => Promise<boolean>;
  setAutoConnect: (id: string, enabled: boolean) => Promise<boolean>;
  setPeerIcon: (id: string, instanceId: string, choice: PeerIconChoice) => Promise<boolean>;
  toggleConnection: (id: string) => Promise<boolean>;
  reconnect: (id: string) => Promise<boolean>;
  saveConfiguration: (id: string, draft: NetworkDraft, mode?: SaveMode, creating?: boolean) => Promise<SaveResult>;
  removeNetwork: (id: string) => Promise<boolean>;
  importConfiguration: (id: string, config: NetworkConfig, alias: string) => Promise<'saved' | 'conflict' | 'storage-error'>;
}

export function createNetworkStore(initialNetworks: Network[], runtime: NetworkRuntime, options: {
  storage?: ConfigurationStorage; connectionEnabled?: boolean; telemetry?: TelemetryStore;
} = {}) {
  return createStore<NetworkStore>()((set, get) => {
    let document = emptyDocument();
    let queue = Promise.resolve();
    let initialization: Promise<void> | undefined;
    const updateNetwork = (id: string, update: (network: Network) => Network) => {
      set((state) => {
        const current = state.networks.find((network) => network.id === id);
        if (!current) return state;
        const next = update(current);
        return next === current ? state : { networks: state.networks.map((network) => network.id === id ? next : network) };
      });
    };
    // Serialize durable mutations. Build the next snapshot only when its turn
    // begins; delayed writes must not revert another saved network or selection.
    const commit = (change: () => { networks: Network[]; selectedId: string } | null): Promise<boolean> => {
      const operation = queue.then(async () => {
        if (get().phase !== 'ready') return false;
        const next = change();
        if (!next) return false;
        set({ writing: true });
        try {
          if (options.storage) {
            document = await options.storage.save(documentFromNetworks(document, next.networks, next.selectedId), document.revision);
          }
          set((state) => ({ selectedId: next.selectedId, storageError: null,
            networks: next.networks.map((network) => {
              const latest = state.networks.find((item) => item.id === network.id);
              return latest ? { ...latest, alias: network.alias, icon: network.icon, savedConfig: network.savedConfig,
                autoConnect: network.autoConnect, ...(network.peerIcons === undefined ? {} : { peerIcons: network.peerIcons }) } : network;
            }) }));
          return true;
        } catch (error) {
          set({ storageError: storageFailure(error) });
          return false;
        } finally { set({ writing: false }); }
      });
      queue = operation.then(() => {});
      return operation;
    };
    const sessions = createNetworkSessions(runtime, {
      read: () => get().networks, update: updateNetwork, telemetry: options.telemetry,
      automatic: (autoConnecting, autoConnectCancelled) => set({ autoConnecting, autoConnectCancelled }),
    });
    return {
      networks: structuredClone(initialNetworks), selectedId: initialNetworks[0]?.id ?? '',
      phase: options.storage ? 'loading' : 'ready', writing: false, storageError: null,
      connectionEnabled: options.connectionEnabled ?? true, autoConnecting: false, autoConnectCancelled: false,
      refreshRuntime: sessions.refresh, dismissAutoConnectNotice: () => set({ autoConnectCancelled: false }),
      initialize: (restore = false) => {
        if (!options.storage) return Promise.resolve();
        if (initialization) return initialization;
        initialization = (async () => {
          await queue;
          set({ phase: 'loading', storageError: null });
          try {
            document = await (restore ? options.storage!.restore() : options.storage!.load());
            const networks = networksFromDocument(document);
            const selectedId = networks.some((network) => network.id === document.selectedId) ? document.selectedId : networks[0]?.id ?? '';
            set({ networks, selectedId, phase: 'ready' });
            if (runtime.snapshot) {
              await sessions.refresh();
              if (get().connectionEnabled) void sessions.autoConnect();
            }
          } catch (error) { set({ phase: 'error', storageError: storageFailure(error) }); }
        })().finally(() => { initialization = undefined; });
        return initialization;
      },
      clearStorageError: () => set({ storageError: null }),
      selectNetwork: (id) => commit(() => get().networks.some((network) => network.id === id) ? { networks: get().networks, selectedId: id } : null),
      setAutoConnect: (id, autoConnect) => commit(() => get().networks.some((network) => network.id === id) ? {
        networks: get().networks.map((network) => network.id === id ? { ...network, autoConnect } : network), selectedId: get().selectedId,
      } : null),
      setPeerIcon: (id, instanceId, choice) => commit(() => {
        const network = get().networks.find((network) => network.id === id);
        const key = peerIconKey({ instanceId });
        if (!network || !key || (choice !== 'auto' && !peerIconKinds.includes(choice))) return null;
        const peerIcons = { ...network.peerIcons };
        if (choice === 'auto') delete peerIcons[key]; else peerIcons[key] = choice;
        return { networks: get().networks.map((item) => item.id === id ? { ...item, peerIcons } : item), selectedId: get().selectedId };
      }),
      toggleConnection: (id) => get().phase === 'ready' && get().connectionEnabled ? sessions.toggle(id) : Promise.resolve(false),
      reconnect: (id) => get().phase === 'ready' && get().connectionEnabled ? sessions.reconnect(id) : Promise.resolve(false),
      importConfiguration: async (id, config, alias) => {
        let conflict = false;
        const saved = await commit(() => {
          if (get().networks.some((item) => item.id === id || (config.tunName && item.savedConfig.tunName.toLowerCase() === config.tunName.toLowerCase()))) {
            conflict = true; return null;
          }
          const network = { ...offlineNetwork(id, structuredClone(config)), alias: alias.trim() || config.name,
            ...(runtime.snapshot ? { peerCount: 0, directPeerCount: 0 } : {}) };
          return { networks: [...get().networks, network], selectedId: id };
        });
        return saved ? 'saved' : conflict ? 'conflict' : 'storage-error';
      },
      removeNetwork: (id) => commit(() => {
        const network = get().networks.find((network) => network.id === id);
        if (!network || !['stopped', 'failed'].includes(network.coreState) || network.runningConfig !== null) return null;
        const networks = get().networks.filter((network) => network.id !== id);
        return { networks, selectedId: get().selectedId === id ? networks[0]?.id ?? '' : get().selectedId };
      }).then((removed) => {
        if (removed) options.telemetry?.remove(id);
        return removed;
      }),
      saveConfiguration: async (id, draft, mode = 'confirm', creating = false) => {
        const network = get().networks.find((item) => item.id === id);
        if (!network && !creating) return { status: 'missing' };
        if (network && (creating || isBusy(network))) return { status: 'busy' };
        const otherTunNames = get().networks.filter((item) => item.id !== id).map((item) => item.savedConfig.tunName);
        const errors = validateDraft(draft, otherTunNames, network?.savedConfig);
        if (Object.keys(errors).length) return { status: 'invalid', errors };
        const previousConfig = network?.savedConfig;
        const config = draftConfig(draft, previousConfig ?? createNetworkConfig(id, { name: draft.name, secret: draft.secret, servers: [] }));
        const localChanged = network && (draft.alias !== network.alias || draft.icon !== network.icon);
        const localOnly = localChanged && configsEqual(config, network.savedConfig);
        const requiresReconnect = network?.coreState === 'running' && network.runningConfig !== null
          && !localOnly && !configsEqual(config, network.runningConfig);
        if (mode === 'confirm' && requiresReconnect) return { status: 'confirmation-required' };
        if (mode === 'now' && requiresReconnect && !get().connectionEnabled) return { status: 'unsupported' };
        let stale = false;
        const saved = await commit(() => {
          const current = get().networks.find((item) => item.id === id);
          if ((creating && current) || (!creating && (!current || isBusy(current) || !configsEqual(current.savedConfig, previousConfig!)))) {
            stale = true; return null;
          }
          // Recheck uniqueness after queued additions, without changing user input.
          if (get().networks.some((item) => item.id !== id && item.savedConfig.tunName.toLowerCase() === config.tunName.toLowerCase())) {
            stale = true; return null;
          }
          const updated = current ? { ...current, alias: draft.alias.trim() || draft.name, icon: draft.icon, savedConfig: config }
            : { ...offlineNetwork(id, config), alias: draft.alias.trim() || draft.name, icon: draft.icon,
              ...(runtime.snapshot ? { peerCount: 0, directPeerCount: 0 } : {}) };
          return { networks: creating ? [...get().networks, updated] : get().networks.map((item) => item.id === id ? updated : item),
            selectedId: creating ? id : get().selectedId };
        });
        if (!saved) return { status: stale ? 'busy' : 'storage-error' };
        if (mode === 'now' && requiresReconnect) return { status: 'applying', completion: get().reconnect(id) };
        return { status: 'saved', pending: hasPendingConfig(get().networks.find((item) => item.id === id)!) };
      },
    };
  });
}

export function newNetworkDraft(networks: Network[], id = newNetworkId()): Network {
  const network = offlineNetwork(id);
  network.savedConfig.tunName = defaultTunName(id, networks.map((network) => network.savedConfig.tunName));
  return network;
}
