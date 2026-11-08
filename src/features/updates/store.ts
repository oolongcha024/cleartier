import { useStore } from 'zustand';
import { updatesAdapter } from '../../platform/updates';
import { createUpdateStore } from './update-store';

const store = createUpdateStore(updatesAdapter);
export const useUpdates = () => useStore(store);
