import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const metadata = JSON.parse(
  execFileSync(
    'cargo',
    [
      'metadata',
      '--locked',
      '--format-version',
      '1',
      '--filter-platform',
      'x86_64-pc-windows-msvc',
      '--manifest-path',
      join(root, 'src-tauri/Cargo.toml'),
    ],
    { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 },
  ),
);
const core = metadata.packages.find((pkg) => pkg.name === 'easytier');
const windivert = metadata.packages.find((pkg) => pkg.name === 'windivert');
const windivertSys = metadata.packages.find((pkg) => pkg.name === 'windivert-sys');
if (!core?.source?.startsWith('git+https://github.com/EasyTier/EasyTier.git?rev=')) {
  throw new Error('Expected the pinned official EasyTier Git dependency.');
}
if (
  !windivertSys?.source?.startsWith('git+https://github.com/EasyTier/windivert-rust.git?rev=') ||
  windivertSys.source !== windivert?.source
) {
  throw new Error(
    'Expected unmodified WinDivert bindings from the same pinned official Git revision.',
  );
}
const source = dirname(core.manifest_path);
const bindings = dirname(windivertSys.manifest_path);
const output = join(root, 'src-tauri/resources/windows');
rmSync(output, { recursive: true, force: true });
mkdirSync(join(output, 'licenses'), { recursive: true });

const files = ['wintun.dll', 'Packet.dll', 'WinDivert64.sys', 'Packet.lib'];
for (const file of files)
  copyFileSync(join(source, 'third_party/x86_64', file), join(output, file));
copyFileSync(join(source, 'LICENSE'), join(output, 'licenses/EasyTier.txt'));
copyFileSync(join(bindings, '..', 'LICENSE'), join(output, 'licenses/windivert-rust.txt'));
copyFileSync(join(bindings, 'vendor/LICENSE'), join(output, 'licenses/WinDivert.txt'));
const manifest = {
  version: core.version,
  source: core.source,
  bindingsSource: windivertSys.source,
  files: files
    .filter((file) => file !== 'Packet.lib')
    .map((file) => ({
      path: file,
      sha256: createHash('sha256')
        .update(readFileSync(join(output, file)))
        .digest('hex'),
    })),
};
writeFileSync(join(output, 'core-resources.json'), JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(
  join(output, 'licenses/SOURCES.txt'),
  [
    `EasyTier ${core.version}: ${core.source}`,
    'The DLL and driver files are copied unchanged from this revision, as in the official GUI.',
    'wintun.dll: https://www.wintun.net/',
    'Packet.dll: https://www.winpcap.org/',
    'WinDivert64.sys: https://github.com/basil00/WinDivert',
    `WinDivert Rust bindings: ${windivertSys.source}`,
    '',
  ].join('\n'),
);
console.log(`Prepared Windows resources from EasyTier ${core.version}.`);
