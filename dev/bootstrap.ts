import { isTauri } from '@tauri-apps/api/core';
import type { Platform } from '../src/platform/contracts.ts';
import { createMockPlatform } from './mock-platform.ts';
import { scenarios } from './scenarios/index.ts';

type MockEnvironment = Awaited<ReturnType<typeof createMockPlatform>>;
export interface DevelopmentSession {
  source: 'native' | 'mock';
  nativeAvailable: boolean;
  scene: string;
  platform: Platform;
  mock: MockEnvironment['controls'] | null;
}
declare global {
  interface Window {
    __CLEARTIER_DEV__?: DevelopmentSession;
  }
}
let dispose = () => {};

export async function initializeDevelopment(native: Platform): Promise<Platform> {
  const query = new URLSearchParams(location.search);
  const nativeAvailable = isTauri();
  const source = query.get('dataSource') === 'mock' || !nativeAvailable ? 'mock' : 'native';
  const requested = query.get('scene') ?? 'default';
  const scene =
    requested === 'testing' || scenarios.some((item) => item.id === requested)
      ? requested
      : 'default';
  if (source === 'mock' && !location.hash)
    location.hash = `#${scenarios.find((item) => item.id === scene)?.route ?? '/'}`;
  const mock = source === 'mock' ? await createMockPlatform(scene) : null;
  const selected = mock?.platform ?? native;
  dispose = mock?.dispose ?? (() => {});
  window.__CLEARTIER_DEV__ = {
    source,
    scene,
    nativeAvailable,
    platform: selected,
    mock: mock?.controls ?? null,
  };
  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) dispose();
  });
  return selected;
}
if (import.meta.hot)
  import.meta.hot.dispose(() => {
    dispose();
    delete window.__CLEARTIER_DEV__;
  });
