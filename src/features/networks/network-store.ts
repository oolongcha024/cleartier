import { createStore } from 'zustand/vanilla';
import { configsEqual, draftConfig, hasPendingConfig, validateDraft, type DraftErrors, type NetworkDraft } from './configuration.ts';
import { isBusy, type Network } from './model.ts';
import type { NetworkRuntime } from './runtime.ts';

export type SaveMode = 'confirm' | 'later' | 'now';
export type SaveResult =
  | { status: 'missing' }
  | { status: 'busy' }
  | { status: 'confirmation-required' }
  | { status: 'invalid'; errors: DraftErrors }
  | { status: 'saved'; pending: boolean }
  | { status: 'applying'; completion: Promise<boolean> };

export interface NetworkStore {
  networks: Network[];
  selectedId: string;
  selectNetwork: (id: string) => void;
  setAutoConnect: (id: string, enabled: boolean) => void;
  toggleConnection: (id: string) => Promise<boolean>;
  reconnect: (id: string) => Promise<boolean>;
  saveConfiguration: (id: string, draft: NetworkDraft, mode?: SaveMode) => SaveResult;
}

// Each instance owns its snapshots and runtime; tests never reset the live store.
export function createNetworkStore(initialNetworks: Network[], runtime: NetworkRuntime) {
  return createStore<NetworkStore>()((set, get) => {
    const updateNetwork = (id: string, update: (network: Network) => Network) => {
      set((state) => ({ networks: state.networks.map((network) => network.id === id ? update(network) : network) }));
    };
    const transition = async (id: string, restart = false): Promise<boolean> => {
      const network = get().networks.find((item) => item.id === id);
      if (!network || isBusy(network) || (restart && network.coreState !== 'running')) return false;
      const connecting = restart || network.coreState === 'stopped';
      const config = structuredClone(network.savedConfig);
      updateNetwork(id, (item) => ({
        ...item,
        coreState: connecting ? 'starting' : 'stopping',
        trafficTotals: connecting ? { downloadBytes: 0, uploadBytes: 0 } : item.trafficTotals,
      }));
      try {
        await runtime(connecting ? { action: restart ? 'restart' : 'start', id, config } : { action: 'stop', id });
        updateNetwork(id, (item) => ({
          ...item,
          coreState: connecting ? 'running' : 'stopped',
          runningConfig: connecting ? config : null,
        }));
        return true;
      } catch {
        // Restore only session state: concurrent local preferences stay intact.
        updateNetwork(id, (item) => ({
          ...item, coreState: network.coreState,
          runningConfig: network.runningConfig, trafficTotals: network.trafficTotals,
        }));
        return false;
      }
    };

    return {
      networks: structuredClone(initialNetworks), selectedId: initialNetworks[0]?.id ?? '',
      selectNetwork: (id) => {
        if (get().networks.some((network) => network.id === id)) set({ selectedId: id });
      },
      setAutoConnect: (id, autoConnect) => updateNetwork(id, (network) => ({ ...network, autoConnect })),
      toggleConnection: (id) => transition(id),
      reconnect: (id) => transition(id, true),
      saveConfiguration: (id, draft, mode = 'confirm') => {
        const network = get().networks.find((item) => item.id === id);
        if (!network) return { status: 'missing' };
        if (isBusy(network)) return { status: 'busy' };
        const otherTunNames = get().networks.filter((item) => item.id !== id).map((item) => item.savedConfig.tunName);
        const errors = validateDraft(draft, otherTunNames);
        if (Object.keys(errors).length) return { status: 'invalid', errors };

        const config = draftConfig(draft, network.savedConfig);
        const localChanged = draft.alias !== network.alias || draft.icon !== network.icon;
        const localOnly = localChanged && configsEqual(config, network.savedConfig);
        const requiresReconnect = network.coreState === 'running' && network.runningConfig !== null
          && !localOnly && !configsEqual(config, network.runningConfig);
        if (mode === 'confirm' && requiresReconnect) return { status: 'confirmation-required' };

        const saved = { ...network, alias: draft.alias.trim() || draft.name, icon: draft.icon, savedConfig: config };
        updateNetwork(id, () => saved);
        if (mode === 'now' && requiresReconnect) return { status: 'applying', completion: get().reconnect(id) };
        return { status: 'saved', pending: hasPendingConfig(saved) };
      },
    };
  });
}
