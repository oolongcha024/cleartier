import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

const root = fileURLToPath(new URL('../', import.meta.url)).replaceAll('\\', '/');

/** Fail release builds if any development module survives tree shaking. */
export function productionGuard(): Plugin {
  return {
    name: 'cleartier-production-guard',
    apply: 'build',
    generateBundle(_options, bundle) {
      for (const output of Object.values(bundle)) {
        if (output.type !== 'chunk') continue;
        for (const id of Object.keys(output.modules)) {
          const normalized = id.replaceAll('\\', '/');
          if (normalized.startsWith(`${root}dev/`) || normalized.startsWith(`${root}tests/`))
            this.error(`Development module included in production: ${id}`);
        }
      }
    },
  };
}
