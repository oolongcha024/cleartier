import { copyFile, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '@tauri-apps/cli';

// The sidebar mask, web icon and desktop assets share this vector source.
const source = await readFile(new URL('../src/assets/logo-mark.svg', import.meta.url), 'utf8');
const mark = source.slice(source.indexOf('>') + 1, source.lastIndexOf('</svg>')).trim();
// Desktop branding stays fixed while the in-app mark follows the selected theme.
const brandBackground = '#3f5f90';
const brandForeground = '#ffffff';
const appIcon = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1024 1024" width="1024" height="1024">
  <rect x="32" y="32" width="960" height="960" rx="256" fill="${brandBackground}" />
  <g transform="translate(172 172) scale(10.625)" color="${brandForeground}">
    ${mark}
  </g>
</svg>
`;
const publicDirectory = new URL('../public/', import.meta.url);
const sourceIcon = new URL('app-icon.svg', publicDirectory);
await mkdir(publicDirectory, { recursive: true });
await writeFile(sourceIcon, appIcon);

// Keep only the icons referenced by the desktop bundle configuration.
const configuration = JSON.parse(
  await readFile(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'),
);
const temporaryDirectory = await mkdtemp(join(tmpdir(), 'cleartier-icons-'));
const desktopDirectory = new URL('../src-tauri/icons/', import.meta.url);
try {
  await run(['icon', fileURLToPath(sourceIcon), '--output', temporaryDirectory]);
  await mkdir(desktopDirectory, { recursive: true });
  for (const icon of configuration.bundle.icon) {
    await copyFile(
      join(temporaryDirectory, basename(icon)),
      new URL(`../src-tauri/${icon}`, import.meta.url),
    );
  }
} finally {
  await rm(temporaryDirectory, { recursive: true, force: true });
}
