import { useStore } from 'zustand';
import { demoNetworks } from './demo';
import { createNetworkStore, type NetworkStore } from './network-store';
import { createDemoRuntime } from './runtime';

// In memory only: simulated connections must never survive as real state.
const networkStore = createNetworkStore(demoNetworks, createDemoRuntime());

export function useNetworkStore<Value>(selector: (state: NetworkStore) => Value): Value {
  return useStore(networkStore, selector);
}
