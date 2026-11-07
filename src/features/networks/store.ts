import { create } from 'zustand';
import { demoNetworks } from './demo';
import { isBusy, type Network } from './model';

interface NetworkStore {
  networks: Network[]; selectedId: string;
  selectNetwork: (id: string) => void;
  setAutoConnect: (id: string, enabled: boolean) => void;
  toggleConnection: (id: string) => Promise<void>;
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
  toggleConnection: async (id) => {
    const network = get().networks.find((item) => item.id === id);
    if (!network || isBusy(network)) return;
    const connecting = network.coreState === 'stopped';
    set((state) => ({ networks: state.networks.map((item) => item.id === id
      ? { ...item, coreState: connecting ? 'starting' : 'stopping',
        trafficTotals: connecting ? { downloadBytes: 0, uploadBytes: 0 } : item.trafficTotals } : item) }));
    await new Promise((resolve) => setTimeout(resolve, 900));
    set((state) => ({
      networks: state.networks.map((item) => item.id === id
        ? { ...item, coreState: connecting ? 'running' : 'stopped' } : item),
    }));
  },
}));
