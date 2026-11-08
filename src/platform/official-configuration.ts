import { invoke } from '@tauri-apps/api/core';
import { isDesktop } from './client';
import type { ConfigurationPreview, OfficialConfiguration } from '../features/networks/official-configuration';

const desktop: OfficialConfiguration = {
  pick: () => invoke<ConfigurationPreview | null>('toml_import'),
  inspect: (id, config) => invoke<ConfigurationPreview>('toml_inspect', { id, config }),
  export: (id, config) => invoke<boolean>('toml_export', { id, config }),
};
const browser: OfficialConfiguration = {
  pick: () => Promise.reject('desktopOnly'),
  inspect: () => Promise.reject('desktopOnly'),
  export: () => Promise.reject('desktopOnly'),
};
export const officialConfiguration = isDesktop() ? desktop : browser;
