import { useStore } from 'zustand';
import { demoNetworks } from './demo';
import { createNetworkStore, type NetworkStore } from './network-store';
import { createDemoRuntime } from './runtime';
import { isDesktop } from '../../platform/client';
import { desktopConfigurationStorage, desktopNetworkRuntime } from '../../platform/configuration';

const networkStore = isDesktop()
  ? createNetworkStore([], desktopNetworkRuntime, {
    storage: desktopConfigurationStorage,
  })
  : createNetworkStore(demoNetworks, createDemoRuntime());

export function useNetworkStore<Value>(selector: (state: NetworkStore) => Value): Value {
  return useStore(networkStore, selector);
}
