import { useStore } from 'zustand';
import { emptyTelemetry } from './telemetry';
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
export function useNetworkTelemetry(id: string) {
  return useStore(telemetry.store, (state) => state[id] ?? emptyTelemetry);
}
export function useNodeHostname(id: string) {
  return useStore(telemetry.store, (state) => state[id]?.snapshot?.hostname ?? null);
}
