import { mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gt, parse, valid } from 'semver';

function selectChannels(releases, repository) {
  const index = { schemaVersion: 1, stable: null, preview: null };
  for (const release of releases) {
    if (release.draft || !release.published_at || !release.tag_name?.startsWith('v')) continue;
    const version = release.tag_name.slice(1);
    const parsed = parse(version);
    if (!parsed || valid(version) !== version || parsed.build.length) continue;
    if (release.prerelease !== parsed.prerelease.length > 0) continue;
    const required = [
      'latest.json',
      'cleartier-windows-x64.zip',
      `ClearTier_${version}_x64-setup.exe`,
    ];
    if (
      !Array.isArray(release.assets) ||
      !required.every(
        (name) =>
          release.assets.filter(
            (asset) =>
              asset.name === name &&
              asset.state === 'uploaded' &&
              asset.size > 0 &&
              asset.browser_download_url ===
                `https://github.com/${repository}/releases/download/v${version}/${name}`,
          ).length === 1,
      )
    )
      continue;
    const candidate = {
      version,
      notes: [...(typeof release.body === 'string' ? release.body : '')].slice(0, 16384).join(''),
    };
    if (!index.preview || gt(version, index.preview.version)) index.preview = candidate;
    if (!parsed.prerelease.length && (!index.stable || gt(version, index.stable.version))) {
      index.stable = candidate;
    }
  }
  return index;
}

/** Rebuild both channels from published releases; callers never maintain moving pointers. */
export async function generateUpdateIndex({
  directory,
  repository = process.env.GITHUB_REPOSITORY ?? 'oolongcha024/cleartier',
  token = process.env.GH_TOKEN,
  apiUrl = 'https://api.github.com',
}) {
  if (!directory || !/^[\w.-]+\/[\w.-]+$/.test(repository)) {
    throw new Error('Update index generation requires an output directory and owner/repository.');
  }
  const releases = [];
  const headers = {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2026-03-10',
    'User-Agent': 'cleartier-update-index',
  };
  if (token) headers.Authorization = `Bearer ${token}`;
  for (let page = 1; ; page++) {
    const response = await fetch(
      `${apiUrl.replace(/\/$/, '')}/repos/${repository}/releases?per_page=100&page=${page}`,
      { headers, redirect: 'error', signal: AbortSignal.timeout(30000) },
    );
    if (!response.ok)
      throw new Error(`Unable to read published releases (HTTP ${response.status}).`);
    const entries = await response.json();
    if (!Array.isArray(entries)) throw new Error('Invalid GitHub release list.');
    releases.push(...entries);
    if (entries.length < 100) break;
  }
  const index = selectChannels(releases, repository);
  const destination = join(directory, 'updates');
  mkdirSync(destination, { recursive: true });
  writeFileSync(join(destination, 'updates.json'), JSON.stringify(index, null, 2) + '\n');
  return index;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length > 3)
      throw new Error('Usage: generate-update-index.mjs [output-directory]');
    const index = await generateUpdateIndex({ directory: process.argv[2] ?? '.cache/update-site' });
    console.log(
      `Update index: stable=${index.stable?.version ?? 'none'}, preview=${index.preview?.version ?? 'none'}`,
    );
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
