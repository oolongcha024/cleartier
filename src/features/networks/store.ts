import { createTelemetryStore, emptyTelemetry } from './telemetry';
import { useStore } from 'zustand';
import { demoNetworks } from './demo';
import { createNetworkStore, type NetworkStore } from './network-store';
import { createDemoRuntime } from './runtime';
import { isDesktop } from '../../platform/client';
import { desktopConfigurationStorage, desktopNetworkRuntime } from '../../platform/configuration';

export const telemetry = createTelemetryStore();

const networkStore = isDesktop()
  ? createNetworkStore([], desktopNetworkRuntime, {
    storage: desktopConfigurationStorage, telemetry,
  })
  : createNetworkStore(demoNetworks, createDemoRuntime());

export function useNetworkStore<Value>(selector: (state: NetworkStore) => Value): Value {
  return useStore(networkStore, selector);
}

// Async user actions re-read their target rather than retaining a render snapshot.
export function readNetwork(id: string) {
  return networkStore.getState().networks.find((network) => network.id === id);
}

export function useNetworkTelemetry(id: string) {
  return useStore(telemetry.store, (state) => state[id] ?? emptyTelemetry);
}

export function useNodeHostname(id: string) {
  return useStore(telemetry.store, (state) => state[id]?.snapshot?.hostname ?? null);
}
