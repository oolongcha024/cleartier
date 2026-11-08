import { useStore } from 'zustand';
import { demoNetworks } from './demo';
import { createNetworkStore, type NetworkStore } from './network-store';
import { createDemoRuntime } from './runtime';
import { isDesktop } from '../../platform/client';
import { desktopConfigurationStorage, readNetworkSnapshot } from '../../platform/configuration';

const networkStore = isDesktop()
  ? createNetworkStore([], async () => { throw new Error('Connection management is not enabled'); }, {
    storage: desktopConfigurationStorage, connectionEnabled: false, snapshot: readNetworkSnapshot,
  })
  : createNetworkStore(demoNetworks, createDemoRuntime());

export function useNetworkStore<Value>(selector: (state: NetworkStore) => Value): Value {
  return useStore(networkStore, selector);
}
