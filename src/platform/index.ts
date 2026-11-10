import { nativePlatform } from './native.ts';
import type { Platform } from './contracts.ts';

export let platform: Platform = nativePlatform;

/** Called before importing the application: stores capture their adapters once.
 * The entire development import disappears from production builds. */
export async function initializePlatform() {
  if (import.meta.env.DEV) {
    const { initializeDevelopment } = await import('../../dev/bootstrap.ts');
    platform = await initializeDevelopment(nativePlatform);
  }
}
