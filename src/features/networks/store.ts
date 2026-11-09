import { useStore } from 'zustand';
import { emptyDevices, emptyTraffic } from './telemetry';
import { createDemoEnvironment } from './demo';
import { createNetworkStore, type NetworkStore } from './network-store';
import { isDesktop } from '../../platform/client';
import { desktopConfigurationStorage, desktopNetworkRuntime } from '../../platform/configuration';

const networkStore = isDesktop()
  ? createNetworkStore(desktopNetworkRuntime, { storage: desktopConfigurationStorage })
  : (() => {
      const demo = createDemoEnvironment();
      return createNetworkStore(demo.runtime, demo);
    })();
export const telemetry = networkStore.telemetry;
export function useNetworkStore<Value>(selector: (state: NetworkStore) => Value): Value {
  return useStore(networkStore, selector);
}
export function readNetwork(id: string) {
  return networkStore.getState().networks.find((network) => network.id === id);
}
export function useNetworkTraffic(id: string) {
  return useStore(telemetry.store, (state) => state[id]?.traffic ?? emptyTraffic);
}
export function useNetworkDevices(id: string) {
  return useStore(telemetry.store, (state) => state[id]?.devices ?? emptyDevices);
}
export function useNodeHostname(id: string) {
  return useStore(telemetry.store, (state) => state[id]?.traffic.snapshot?.hostname ?? null);
}
