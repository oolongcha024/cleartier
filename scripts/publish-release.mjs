import { createHash } from 'node:crypto';
import { createReadStream, lstatSync, readFileSync } from 'node:fs';
import { basename, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// build-info.json is internal build evidence, never a Release attachment.
async function readPackages(root, directory, tag, commit, repository) {
  const { version } = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
  if (typeof version !== 'string' || tag !== `v${version}`) throw new Error('Release tag must match package.json version.');
  const info = JSON.parse(readFileSync(join(directory, 'build-info.json'), 'utf8'));
  if (info.version !== version || info.source?.commit !== commit || info.source?.ref !== `refs/tags/${tag}` ||
      info.mode !== 'all' || info.target !== 'x86_64-pc-windows-msvc') {
    throw new Error('Build evidence must match this tag, commit and complete Windows x64 build.');
  }
  const entries = info.files;
  if (!Array.isArray(entries) || entries.length !== 3 ||
      entries.filter(file => file.path === 'latest.json').length !== 1 ||
      entries.filter(file => file.path === 'cleartier-windows-x64.zip').length !== 1 ||
      entries.filter(file => typeof file.path === 'string' && /^nsis\/[^/\\]+-setup\.exe$/.test(file.path)).length !== 1) {
    throw new Error('Expected exactly one portable ZIP, one NSIS installer and latest.json in build evidence.');
  }
  const files = [];
  for (const entry of entries) {
    const path = join(directory, entry.path);
    const stat = lstatSync(path);
    const hash = createHash('sha256');
    if (!stat.isFile() || stat.size !== entry.size || stat.size === 0) throw new Error(`Invalid package size or type: ${entry.path}`);
    for await (const bytes of createReadStream(path)) hash.update(bytes);
    const digest = `sha256:${hash.digest('hex')}`;
    if (digest !== `sha256:${entry.sha256}`) throw new Error(`Package checksum mismatch: ${entry.path}`);
    files.push({ path, name: basename(path), size: stat.size, digest });
  }
  const manifest = JSON.parse(readFileSync(join(directory, 'latest.json'), 'utf8'));
  const installer = files.find(file => file.name.endsWith('-setup.exe'));
  const update = manifest.platforms?.['windows-x86_64'];
  const expectedUrl = `https://github.com/${repository}/releases/download/${tag}/${installer.name}`;
  if (manifest.version !== version || update?.url !== expectedUrl || typeof update.signature !== 'string' || !update.signature.trim()) {
    throw new Error('Update manifest must match the signed installer and application version.');
  }
  return { files, prerelease: version.includes('-') };
}

export async function publishRelease({ root, directory, tag, commit, repository, token, apiUrl = 'https://api.github.com' }) {
  if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '') || !/^[a-f0-9]{40,64}$/i.test(commit ?? '')) {
    throw new Error('Publishing requires a token, owner/repository and commit SHA.');
  }
  const { files, prerelease } = await readPackages(root, directory, tag, commit, repository);
  const base = `${apiUrl.replace(/\/$/, '')}/repos/${repository}`;

  async function request(method, endpoint, { json, file, allowMissing = false } = {}) {
    const headers = { Accept: 'application/vnd.github+json', Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10', 'User-Agent': 'cleartier-release' };
    const options = { method, headers, redirect: 'error', signal: AbortSignal.timeout(file ? 300_000 : 30_000) };
    if (json !== undefined) {
      headers['Content-Type'] = 'application/json';
      options.body = JSON.stringify(json);
    }
    if (file) {
      headers['Content-Type'] = file.name.endsWith('.zip') ? 'application/zip' : 'application/octet-stream';
      headers['Content-Length'] = String(file.size);
      options.body = createReadStream(file.path);
      options.duplex = 'half';
    }
    const response = await fetch(endpoint.startsWith('http') ? endpoint : `${base}${endpoint}`, options);
    if (allowMissing && response.status === 404) { await response.body?.cancel(); return null; }
    const body = await response.text();
    if (!response.ok) throw new Error(`GitHub ${method} failed (${response.status}): ${body.slice(0, 500)}`);
    return body ? JSON.parse(body) : null;
  }

  async function checkTag() {
    let { object } = await request('GET', `/git/ref/tags/${encodeURIComponent(tag)}`);
    for (let depth = 0; object?.type === 'tag' && depth < 5; depth++) {
      ({ object } = await request('GET', `/git/tags/${object.sha}`));
    }
    if (object?.type !== 'commit' || object.sha !== commit) throw new Error('Remote release tag no longer points to the built commit.');
  }

  function matches(asset, file) {
    return asset?.state === 'uploaded' && asset.size === file.size && asset.digest === file.digest;
  }

  async function assetsFor(release) {
    const assets = await request('GET', `/releases/${release.id}/assets?per_page=100`);
    if (assets.some(asset => !files.some(file => asset.name === file.name)) || new Set(assets.map(asset => asset.name)).size !== assets.length) {
      throw new Error('Release contains unexpected assets; only ZIP, NSIS and latest.json may be published.');
    }
    return assets;
  }

  function verifyAssets(assets) {
    if (assets.length !== files.length || files.some(file => !matches(assets.find(asset => asset.name === file.name), file))) {
      throw new Error('Release assets do not match the verified packages and update manifest.');
    }
  }

  await checkTag();
  let release = await request('GET', `/releases/tags/${encodeURIComponent(tag)}`, { allowMissing: true });
  // The by-tag endpoint is for published releases. Authenticated listing also
  // finds drafts, including one left behind by a failed upload or a human.
  for (let page = 1; !release; page++) {
    const candidates = await request('GET', `/releases?per_page=100&page=${page}`);
    release = candidates.find(candidate => candidate.tag_name === tag);
    if (candidates.length < 100) break;
  }
  if (release && !release.draft) {
    // Rerunning a completed publish is harmless; published bytes are immutable.
    verifyAssets(await assetsFor(release));
    if (release.prerelease !== prerelease) throw new Error('Published release has the wrong prerelease status.');
    return { status: 'already-published', url: release.html_url };
  }
  if (!release) {
    release = await request('POST', '/releases', { json: { tag_name: tag, target_commitish: commit,
      name: tag, draft: true, prerelease, generate_release_notes: true, make_latest: 'false' } });
  }
  if (!release.draft || release.tag_name !== tag) throw new Error('Expected an unpublished draft for the requested tag.');

  const existing = await assetsFor(release);
  for (const file of files) {
    const asset = existing.find(item => item.name === file.name);
    if (matches(asset, file)) continue;
    if (asset) await request('DELETE', `/releases/assets/${asset.id}`);
    const url = new URL(release.upload_url.replace(/\{.*$/, ''));
    url.searchParams.set('name', file.name);
    await request('POST', url.href, { file });
  }
  verifyAssets(await assetsFor(release));
  await checkTag();
  // Preserve an existing draft's title and notes, and publish only after all
  // remote digests match. This also supports GitHub immutable releases.
  release = await request('PATCH', `/releases/${release.id}`, { json: {
    draft: false, prerelease, make_latest: prerelease ? 'false' : 'legacy',
  } });
  if (release.draft) throw new Error('GitHub did not publish the release.');
  return { status: 'published', url: release.html_url };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    if (process.argv.length !== 3 || process.env.GITHUB_EVENT_NAME !== 'push' || !process.env.GITHUB_REF?.startsWith('refs/tags/v')) {
      throw new Error('Usage: publish-release.mjs <artifact-directory>, from a version-tag push workflow.');
    }
    const result = await publishRelease({ root: fileURLToPath(new URL('../', import.meta.url)), directory: resolve(process.argv[2]),
      tag: process.env.GITHUB_REF.slice(10), commit: process.env.GITHUB_SHA, repository: process.env.GITHUB_REPOSITORY,
      token: process.env.GH_TOKEN, apiUrl: process.env.GITHUB_API_URL });
    console.log(`Release ${result.status}: ${result.url}`);
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
