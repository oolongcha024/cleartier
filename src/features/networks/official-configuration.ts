import type { NetworkConfig } from './model';

export interface CompatibilityIssue { path: string; code: string }
export interface ConfigurationPreview {
  id: string;
  config: NetworkConfig;
  issues: CompatibilityIssue[];
  preservedFields: string[];
}
// The file chooser, pinned-core conversion and credential-safe errors are hidden
// behind this Interface. A browser never falls back after a native error.
export interface OfficialConfiguration {
  pick: () => Promise<ConfigurationPreview | null>;
  inspect: (id: string, config: NetworkConfig) => Promise<ConfigurationPreview>;
  export: (id: string, config: NetworkConfig) => Promise<boolean>;
}
export function transferError(error: unknown): string {
  return typeof error === 'string' && ['invalid', 'io', 'tooLarge', 'desktopOnly'].includes(error) ? error : 'io';
}
