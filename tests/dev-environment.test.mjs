import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { devEnvironment } from '../scripts/dev-environment.ts';
import { tauriArguments } from '../scripts/tauri.mjs';

function fixture(t, contents) {
  const root = mkdtempSync(join(tmpdir(), 'cleartier-dev-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (contents !== undefined) writeFileSync(join(root, '.env.local'), contents);
  return { root, env: {} };
}

test('a fresh checkout uses localhost and matches the static desktop configuration', (t) => {
  const development = devEnvironment(fixture(t));
  assert.deepEqual(development, {
    host: 'localhost',
    port: 5173,
    previewPort: 4174,
    devUrl: 'http://localhost:5173',
    previewUrl: 'http://localhost:4174',
  });
  const config = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url)));
  assert.equal(config.build.devUrl, development.devUrl);
});

test('local dotenv parsing only selects the host and does not mutate the environment', (t) => {
  const options = fixture(t, 'CLEARTIER_DEV_HOST="192.0.2.10" # remote preview\nOTHER=unused\n');
  assert.equal(devEnvironment(options).devUrl, 'http://192.0.2.10:5173');
  assert.deepEqual(options.env, {});
  writeFileSync(join(options.root, '.env.local'), 'OTHER=unused\n');
  assert.equal(devEnvironment(options).host, 'localhost');
});

test('the environment takes precedence without reading the local file', (t) => {
  const options = fixture(t, 'CLEARTIER_DEV_HOST=192.0.2.10\n');
  options.env.CLEARTIER_DEV_HOST = ' dev.example.test ';
  assert.equal(devEnvironment(options).devUrl, 'http://dev.example.test:5173');
  rmSync(join(options.root, '.env.local'));
  mkdirSync(join(options.root, '.env.local'));
  assert.equal(devEnvironment(options).host, 'dev.example.test');
  assert.throws(() => devEnvironment({ ...options, env: {} }));
});

test('IPv6 addresses are unbracketed for listening and bracketed in URLs', (t) => {
  const options = fixture(t);
  for (const host of ['::1', '[::1]']) {
    const development = devEnvironment({ ...options, env: { CLEARTIER_DEV_HOST: host } });
    assert.equal(development.host, '::1');
    assert.equal(development.devUrl, 'http://[::1]:5173');
    assert.equal(development.previewUrl, 'http://[::1]:4174');
  }
});

test('invalid addresses fail clearly instead of silently falling back', (t) => {
  const options = fixture(t, 'CLEARTIER_DEV_HOST=192.0.2.10');
  for (const host of [
    '',
    'http://localhost',
    'localhost:5173',
    'localhost/path',
    'localhost?x',
    '0.0.0.0',
    '::',
    '0:0:0:0:0:0:0:0',
    '[::1x',
    '999.999.999.999',
    '[localhost]',
    '-invalid',
  ]) {
    assert.throws(
      () => devEnvironment({ ...options, env: { CLEARTIER_DEV_HOST: host } }),
      /CLEARTIER_DEV_HOST must be a concrete hostname or IP address/,
      host,
    );
  }
});

test('desktop development merges the address after user config and preserves runner arguments', (t) => {
  const options = fixture(t, 'CLEARTIER_DEV_HOST=192.0.2.10');
  const args = ['-vv', 'dev', '--config', 'custom.json', '--', '--locked', '--', '--help'];
  const actual = tauriArguments(args, options);
  assert.deepEqual(actual.slice(0, 4), args.slice(0, 4));
  assert.equal(actual[4], '--config');
  assert.deepEqual(JSON.parse(actual[5]), { build: { devUrl: devEnvironment(options).devUrl } });
  assert.deepEqual(actual.slice(6), args.slice(4));
  assert.deepEqual(args, [
    '-vv',
    'dev',
    '--config',
    'custom.json',
    '--',
    '--locked',
    '--',
    '--help',
  ]);
  const simple = tauriArguments(['dev'], options);
  assert.deepEqual(simple, ['dev', '--config', actual[5]]);
});

test('builds, other commands and CLI help bypass local host configuration', (t) => {
  const options = fixture(t, 'CLEARTIER_DEV_HOST=invalid/path');
  for (const args of [
    ['build', '--config', 'release.json', '--', '--locked'],
    ['dev', '--help'],
    ['dev', '-h'],
    ['--verbose', 'dev', '--help'],
    ['--version'],
    ['info'],
    [],
  ]) {
    assert.strictEqual(tauriArguments(args, options), args);
  }
});
