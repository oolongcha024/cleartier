import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { publishRelease } from '../scripts/publish-release.mjs';

const commit = 'a'.repeat(40);
const digest = (bytes) => `sha256:${createHash('sha256').update(bytes).digest('hex')}`;

async function fixture(t, { version = '0.1.0-rc.1', initial } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'cleartier-publish-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const directory = join(root, 'packages');
  mkdirSync(join(directory, 'nsis'), { recursive: true });
  writeFileSync(join(root, 'package.json'), JSON.stringify({ version }));
  const files = ['cleartier-windows-x64.zip', `nsis/ClearTier_${version}_x64-setup.exe`].map(
    (path, index) => {
      const bytes = Buffer.from(`package ${index} for ${version}`);
      writeFileSync(join(directory, path), bytes);
      return { path, size: bytes.length, sha256: digest(bytes).slice(7) };
    },
  );
  const update = {
    version,
    platforms: {
      'windows-x86_64': {
        url: `https://github.com/owner/cleartier/releases/download/v${version}/ClearTier_${version}_x64-setup.exe`,
        signature: 'fixture-signature',
      },
    },
  };
  const updateBytes = Buffer.from(JSON.stringify(update));
  writeFileSync(join(directory, 'latest.json'), updateBytes);
  files.push({
    path: 'latest.json',
    size: updateBytes.length,
    sha256: digest(updateBytes).slice(7),
  });
  const manifest = {
    version,
    target: 'x86_64-pc-windows-msvc',
    mode: 'all',
    source: { commit, ref: `refs/tags/v${version}` },
    files,
  };
  function saveManifest() {
    writeFileSync(join(directory, 'build-info.json'), JSON.stringify(manifest));
  }
  saveManifest();
  const state = {
    release: null,
    assets: [],
    trace: [],
    uploads: 0,
    failUpload: 0,
    corruptDigest: false,
    moveTag: false,
    annotated: false,
    tagReads: 0,
    forbidden: false,
  };
  function assetFor(file, id) {
    return {
      id,
      name: file.path.split('/').at(-1),
      size: file.size,
      digest: `sha256:${file.sha256}`,
      state: 'uploaded',
    };
  }
  const server = createServer(async (req, res) => {
    const chunks = [];
    for await (const bytes of req) chunks.push(bytes);
    const bytes = Buffer.concat(chunks);
    const url = new URL(req.url, 'http://localhost');
    const json = req.headers['content-type'] === 'application/json' ? JSON.parse(bytes) : null;
    state.trace.push({
      method: req.method,
      path: url.pathname,
      name: url.searchParams.get('name'),
      json,
    });
    res.setHeader('Content-Type', 'application/json');
    function send(code, body) {
      res.statusCode = code;
      res.end(body === undefined ? undefined : JSON.stringify(body));
    }
    if (req.headers.authorization !== 'Bearer fixture-token' || state.forbidden)
      return send(403, { message: 'Forbidden' });
    const base = '/repos/owner/cleartier';
    if (req.method === 'GET' && url.pathname === `${base}/git/ref/tags/v${version}`) {
      state.tagReads++;
      const sha = state.moveTag && state.tagReads > 1 ? 'b'.repeat(40) : commit;
      return send(200, { object: { type: state.annotated ? 'tag' : 'commit', sha } });
    }
    if (req.method === 'GET' && url.pathname === `${base}/git/tags/${commit}`) {
      return send(200, { object: { type: 'commit', sha: commit } });
    }
    if (req.method === 'GET' && url.pathname === `${base}/releases/tags/v${version}`) {
      return state.release && !state.release.draft
        ? send(200, state.release)
        : send(404, { message: 'Not Found' });
    }
    if (req.method === 'GET' && url.pathname === `${base}/releases`)
      return send(200, state.release ? [state.release] : []);
    if (req.method === 'POST' && url.pathname === `${base}/releases`) {
      state.release = {
        ...json,
        id: 7,
        upload_url: `${apiUrl}/uploads/7/assets{?name,label}`,
        html_url: 'https://example.invalid/release',
      };
      return send(201, state.release);
    }
    if (req.method === 'GET' && url.pathname === `${base}/releases/7/assets`)
      return send(200, state.assets);
    if (req.method === 'DELETE' && url.pathname.startsWith(`${base}/releases/assets/`)) {
      assert.equal(state.release.draft, true);
      state.assets = state.assets.filter(
        (asset) => asset.id !== Number(url.pathname.split('/').at(-1)),
      );
      return send(204);
    }
    if (req.method === 'POST' && url.pathname === '/uploads/7/assets') {
      assert.equal(state.release.draft, true);
      assert.equal(Number(req.headers['content-length']), bytes.length);
      state.uploads++;
      if (state.uploads === state.failUpload) return send(500, { message: 'Upload failed' });
      const asset = {
        id: 100 + state.uploads,
        name: url.searchParams.get('name'),
        size: bytes.length,
        digest: state.corruptDigest ? 'sha256:incorrect' : digest(bytes),
        state: 'uploaded',
      };
      state.assets.push(asset);
      return send(201, asset);
    }
    if (req.method === 'PATCH' && url.pathname === `${base}/releases/7`) {
      assert.equal(state.assets.length, 3);
      state.release = { ...state.release, ...json, immutable: true };
      return send(200, state.release);
    }
    send(500, { message: `Unexpected ${req.method} ${req.url}` });
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const apiUrl = `http://127.0.0.1:${server.address().port}`;
  t.after(
    () =>
      new Promise((resolve) => {
        server.close(resolve);
        server.closeAllConnections();
      }),
  );
  if (initial) {
    state.release = {
      id: 7,
      tag_name: `v${version}`,
      draft: initial === 'draft',
      prerelease: version.includes('-'),
      name: 'Custom title',
      body: 'Preserve my notes',
      immutable: initial === 'published',
      upload_url: `${apiUrl}/uploads/7/assets{?name,label}`,
      html_url: 'https://example.invalid/release',
    };
  }
  const options = {
    root,
    directory,
    tag: `v${version}`,
    commit,
    repository: 'owner/cleartier',
    token: 'fixture-token',
    apiUrl,
  };
  return { root, directory, options, state, manifest, saveManifest, assetFor, files };
}

for (const version of ['0.1.0-alpha.1', '0.1.0-beta.2', '0.1.0-rc.1', '0.1.0']) {
  test(`${version}: create draft, upload ZIP, NSIS and signed manifest, verify, then publish`, async (t) => {
    const { options, state, files } = await fixture(t, { version });
    const result = await publishRelease(options);
    assert.equal(result.status, 'published');
    const changes = state.trace.filter((event) => event.method !== 'GET');
    assert.deepEqual(
      changes.map((event) => event.method),
      ['POST', 'POST', 'POST', 'POST', 'PATCH'],
    );
    assert.equal(changes[0].json.draft, true);
    assert.equal(changes[0].json.generate_release_notes, true);
    assert.deepEqual(
      changes.slice(1, 4).map((event) => event.name),
      files.map((file) => file.path.split('/').at(-1)),
    );
    assert.equal(changes.at(-1).json.draft, false);
    assert.equal(changes.at(-1).json.prerelease, version.includes('-'));
    assert.equal(changes.at(-1).json.make_latest, version.includes('-') ? 'false' : 'legacy');
    assert.equal(state.tagReads, 2);
    assert.deepEqual(
      state.assets.filter((asset) => asset.name.endsWith('.json')).map((asset) => asset.name),
      ['latest.json'],
    );
  });
}

test('corrupted local package is rejected before any GitHub request', async (t) => {
  const { options, directory, state } = await fixture(t);
  const path = join(directory, 'cleartier-windows-x64.zip');
  const bytes = readFileSync(path);
  bytes[0] ^= 1;
  writeFileSync(path, bytes);
  await assert.rejects(publishRelease(options), /checksum mismatch/);
  assert.deepEqual(state.trace, []);
});

for (const field of ['version', 'url', 'signature']) {
  test(`invalid update manifest (${field}) is rejected before creating a draft`, async (t) => {
    const { options, directory, state, manifest, saveManifest } = await fixture(t);
    const path = join(directory, 'latest.json');
    const update = JSON.parse(readFileSync(path, 'utf8'));
    if (field === 'version') update.version = '9.0.0';
    else
      update.platforms['windows-x86_64'][field] =
        field === 'url' ? 'https://example.invalid/setup.exe' : '';
    const bytes = Buffer.from(JSON.stringify(update));
    writeFileSync(path, bytes);
    Object.assign(
      manifest.files.find((file) => file.path === 'latest.json'),
      { size: bytes.length, sha256: digest(bytes).slice(7) },
    );
    saveManifest();
    await assert.rejects(publishRelease(options), /Update manifest/);
    assert.deepEqual(state.trace, []);
  });
}

for (const change of ['commit', 'ref', 'mode', 'target', 'version', 'files']) {
  test(`incorrect build evidence (${change}) cannot create a release`, async (t) => {
    const { options, manifest, saveManifest, state } = await fixture(t);
    if (change === 'commit' || change === 'ref') manifest.source[change] = 'wrong';
    else if (change === 'files') manifest.files.push({ path: 'build-info.json' });
    else manifest[change] = 'wrong';
    saveManifest();
    await assert.rejects(publishRelease(options), /Build evidence|Expected exactly/);
    assert.deepEqual(state.trace, []);
  });
}

test('tag must equal the canonical version before publishing', async (t) => {
  const { options, state } = await fixture(t);
  await assert.rejects(publishRelease({ ...options, tag: 'v0.1.0' }), /package.json/);
  assert.deepEqual(state.trace, []);
});

test('upload failure leaves a draft; retry reuses the good asset and preserves custom notes', async (t) => {
  const { options, state } = await fixture(t);
  state.failUpload = 2;
  await assert.rejects(publishRelease(options), /500/);
  assert.equal(state.release.draft, true);
  assert.equal(state.assets.length, 1);
  assert.ok(state.trace.every((event) => event.method !== 'PATCH'));
  state.release.name = 'Custom title';
  state.release.body = 'Preserve my notes';
  state.failUpload = 0;
  await publishRelease(options);
  assert.equal(state.uploads, 4);
  assert.equal(state.release.name, 'Custom title');
  assert.equal(state.release.body, 'Preserve my notes');
  assert.equal(
    state.trace.filter((event) => event.path.endsWith('/releases') && event.method === 'POST')
      .length,
    1,
  );
});

test('only stale draft assets are replaced', async (t) => {
  const { options, state, files, assetFor } = await fixture(t, { initial: 'draft' });
  state.assets = files.map((file, index) => assetFor(file, index + 1));
  state.assets[0].digest = 'sha256:old';
  await publishRelease(options);
  assert.equal(state.uploads, 1);
  const deletions = state.trace.filter((event) => event.method === 'DELETE');
  assert.equal(deletions.length, 1);
  assert.ok(deletions[0].path.endsWith('/assets/1'));
});

test('a completed immutable release can be retried without modification', async (t) => {
  const { options, state, files, assetFor } = await fixture(t, { initial: 'published' });
  state.assets = files.map(assetFor);
  assert.equal((await publishRelease(options)).status, 'already-published');
  assert.ok(state.trace.every((event) => event.method === 'GET'));
});

test('published files are never overwritten when a rebuild differs', async (t) => {
  const { options, state, files, assetFor } = await fixture(t, { initial: 'published' });
  state.assets = files.map(assetFor);
  state.assets[0].digest = 'sha256:old';
  await assert.rejects(publishRelease(options), /do not match/);
  assert.ok(state.trace.every((event) => event.method === 'GET'));
});

test('remote checksum mismatch prevents final publication', async (t) => {
  const { options, state } = await fixture(t);
  state.corruptDigest = true;
  await assert.rejects(publishRelease(options), /do not match/);
  assert.equal(state.release.draft, true);
  assert.ok(state.trace.every((event) => event.method !== 'PATCH'));
});

test('a tag moved during uploads leaves the release unpublished', async (t) => {
  const { options, state } = await fixture(t);
  state.moveTag = true;
  await assert.rejects(publishRelease(options), /built commit/);
  assert.equal(state.release.draft, true);
  assert.ok(state.trace.every((event) => event.method !== 'PATCH'));
});

test('annotated tags resolve to the built commit', async (t) => {
  const { options, state } = await fixture(t);
  state.annotated = true;
  assert.equal((await publishRelease(options)).status, 'published');
  assert.equal(state.trace.filter((event) => event.path.includes('/git/tags/')).length, 2);
});

test('unexpected draft attachments are preserved and block publishing', async (t) => {
  const { options, state } = await fixture(t, { initial: 'draft' });
  state.assets.push({ id: 1, name: 'build-info.json' });
  await assert.rejects(publishRelease(options), /unexpected assets/);
  assert.equal(state.release.draft, true);
  assert.ok(state.trace.every((event) => event.method === 'GET'));
});

test('API permission failures are not mistaken for missing releases', async (t) => {
  const { options, state } = await fixture(t);
  state.forbidden = true;
  await assert.rejects(publishRelease(options), /403/);
  assert.equal(state.release, null);
  assert.ok(state.trace.every((event) => event.method === 'GET'));
});

test('CLI refuses manual or branch workflows before accessing GitHub', () => {
  const result = spawnSync(
    process.execPath,
    [fileURLToPath(new URL('../scripts/publish-release.mjs', import.meta.url)), '.'],
    {
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'workflow_dispatch',
        GITHUB_REF: 'refs/heads/main',
        GH_TOKEN: '',
      },
    },
  );
  assert.equal(result.status, 1);
  assert.match(result.stderr, /version-tag push workflow/);
});
