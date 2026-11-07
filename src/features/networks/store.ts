import { create } from 'zustand';
import { demoNetworks } from './demo.ts';
import { isBusy, type Network } from './model.ts';
import { draftConfig, hasPendingConfig, validateDraft, type NetworkDraft } from './configuration.ts';

interface NetworkStore {
  networks: Network[]; selectedId: string;
  selectNetwork: (id: string) => void;
  setAutoConnect: (id: string, enabled: boolean) => void;
  toggleConnection: (id: string) => Promise<void>;
  reconnect: (id: string) => Promise<boolean>;
  saveConfiguration: (id: string, draft: NetworkDraft) => boolean;
  applyConfiguration: (id: string) => Promise<boolean>;
}
// In memory only: simulated connections must never survive as real state.
export const useNetworkStore = create<NetworkStore>((set, get) => ({
  networks: demoNetworks, selectedId: demoNetworks[0].id,
  selectNetwork: (id) => {
    if (get().networks.some((network) => network.id === id)) set({ selectedId: id });
  },
  setAutoConnect: (id, autoConnect) => set((state) => ({
    networks: state.networks.map((network) => network.id === id ? { ...network, autoConnect } : network),
  })),
  saveConfiguration: (id, draft) => {
    const network = get().networks.find((item) => item.id === id);
    const otherTunNames = get().networks.filter((item) => item.id !== id).map((item) => item.savedConfig.tunName);
    if (!network || isBusy(network) || Object.keys(validateDraft(draft, otherTunNames)).length) return false;
    set((state) => ({ networks: state.networks.map((item) => item.id === id
      ? { ...item, alias: draft.alias.trim() || draft.name, icon: draft.icon, savedConfig: draftConfig(draft, item.savedConfig) } : item) }));
    return true;
  },
  applyConfiguration: async (id) => {
    const network = get().networks.find((item) => item.id === id);
    if (!network || network.coreState !== 'running' || !hasPendingConfig(network)) return false;
    return get().reconnect(id);
  },
  reconnect: async (id) => {
    const network = get().networks.find((item) => item.id === id);
    if (!network || network.coreState !== 'running') return false;
    const config = structuredClone(network.savedConfig);
    set((state) => ({ networks: state.networks.map((item) => item.id === id
      ? { ...item, coreState: 'starting', trafficTotals: { downloadBytes: 0, uploadBytes: 0 } } : item) }));
    await new Promise((resolve) => setTimeout(resolve, 900));
    set((state) => ({ networks: state.networks.map((item) => item.id === id
      ? { ...item, coreState: 'running', runningConfig: config } : item) }));
    return true;
  },
  toggleConnection: async (id) => {
    const network = get().networks.find((item) => item.id === id);
    if (!network || isBusy(network)) return;
    const connecting = network.coreState === 'stopped';
    const config = structuredClone(network.savedConfig);
    set((state) => ({ networks: state.networks.map((item) => item.id === id
      ? { ...item, coreState: connecting ? 'starting' : 'stopping',
        trafficTotals: connecting ? { downloadBytes: 0, uploadBytes: 0 } : item.trafficTotals } : item) }));
    await new Promise((resolve) => setTimeout(resolve, 900));
    set((state) => ({
      networks: state.networks.map((item) => item.id === id
        ? { ...item, coreState: connecting ? 'running' : 'stopped', runningConfig: connecting ? config : null } : item),
    }));
  },
}));
