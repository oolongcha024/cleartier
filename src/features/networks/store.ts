import { useStore } from 'zustand';
import { emptyDevices, emptyTraffic } from './telemetry';
import { createNetworkStore, type NetworkStore } from './network-store';
import { platform } from '../../platform';

const networkStore = createNetworkStore(platform.networks.runtime, platform.networks);
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
