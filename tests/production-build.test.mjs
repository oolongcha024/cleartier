import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { build } from 'vite';
import { productionGuard } from '../scripts/production-guard.ts';

const mockEntry = fileURLToPath(new URL('../dev/mock-updates.ts', import.meta.url));

test('production build rejects reachable development code', async () => {
  await assert.rejects(
    build({
      configFile: false,
      logLevel: 'silent',
      plugins: [productionGuard()],
      build: { write: false, minify: false, lib: { entry: mockEntry, formats: ['es'] } },
    }),
    /Development module included in production/,
  );
});

test('production builds eliminate development imports behind the development flag', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'cleartier-production-test-'));
  try {
    const entry = join(directory, 'entry.mjs');
    await writeFile(
      entry,
      `export async function start() { if (import.meta.env.DEV) return import(${JSON.stringify(mockEntry)}); return 'native'; }`,
    );
    const result = await build({
      configFile: false,
      logLevel: 'silent',
      plugins: [productionGuard()],
      build: { write: false, minify: false, lib: { entry, formats: ['es'] } },
    });
    const chunks = (Array.isArray(result) ? result : [result]).flatMap((bundle) => bundle.output);
    assert.ok(chunks.some((chunk) => chunk.type === 'chunk' && chunk.code.includes('native')));
    assert.ok(
      chunks.every((chunk) => chunk.type !== 'chunk' || !chunk.code.includes('createMockUpdates')),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
