import assert from 'node:assert/strict';
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { stageProgram } from '../scripts/windows/build.mjs';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'cleartier-package-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const resources = join(root, 'src-tauri/resources/windows');
  mkdirSync(join(resources, 'licenses'), { recursive: true });
  copyFileSync(
    new URL('../src-tauri/tauri.windows.conf.json', import.meta.url),
    join(root, 'src-tauri/tauri.windows.conf.json'),
  );
  const executable = join(root, 'release.exe');
  writeFileSync(executable, Buffer.from([0x4d, 0x5a, 0, 1]));
  writeFileSync(join(root, 'LICENSE'), 'project license');
  for (const name of [
    'wintun.dll',
    'Packet.dll',
    'WinDivert64.sys',
    'Packet.lib',
    'core-resources.json',
    'check-core.ps1',
    'debug.pdb',
  ]) {
    writeFileSync(join(resources, name), `fixture ${name}`);
  }
  for (const name of ['EasyTier.txt', 'windivert-rust.txt', 'WinDivert.txt', 'SOURCES.txt']) {
    writeFileSync(join(resources, 'licenses', name), `license ${name}`);
  }
  return { root, resources, executable, destination: join(root, 'ClearTier') };
}

function files(directory, prefix = '') {
  return readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const path = `${prefix}${entry.name}`;
      return entry.isDirectory() ? files(join(directory, entry.name), `${path}/`) : [path];
    })
    .sort();
}

test('Windows package contains only the executable, runtime files and license information', (t) => {
  const { root, resources, executable, destination } = fixture(t);
  mkdirSync(destination);
  writeFileSync(join(destination, 'stale-check.ps1'), 'previous build');
  stageProgram(executable, destination, root);
  assert.deepEqual(
    files(destination),
    [
      'LICENSE',
      'Packet.dll',
      'WinDivert64.sys',
      'cleartier.exe',
      'licenses/EasyTier.txt',
      'licenses/SOURCES.txt',
      'licenses/WinDivert.txt',
      'licenses/windivert-rust.txt',
      'wintun.dll',
    ].sort(),
  );
  assert.deepEqual(readFileSync(join(destination, 'cleartier.exe')), readFileSync(executable));
  for (const name of ['wintun.dll', 'Packet.dll', 'WinDivert64.sys']) {
    assert.deepEqual(readFileSync(join(destination, name)), readFileSync(join(resources, name)));
  }
  assert.equal(readFileSync(join(destination, 'LICENSE'), 'utf8'), 'project license');
});

test('a missing runtime dependency prevents a successful Windows staging operation', (t) => {
  const { root, resources, executable, destination } = fixture(t);
  rmSync(join(resources, 'Packet.dll'));
  assert.throws(() => stageProgram(executable, destination, root), { code: 'ENOENT' });
});
