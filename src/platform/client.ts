import { platform } from './index';
export type { HostEnvironment } from './contracts';
export const readHostEnvironment = () => platform.client.readHostEnvironment();
export const readClientVersion = () => platform.client.readClientVersion();
export const readCoreVersion = () => platform.client.readCoreVersion();
