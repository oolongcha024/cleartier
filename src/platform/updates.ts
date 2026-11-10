import { platform } from './index';
export type { UpdatePreferences, UpdateSnapshot, UpdateCommand, UpdateAdapter } from './contracts';
export const updatesAdapter = platform.updates;
