import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { generateUpdateIndex } from '../scripts/generate-update-index.mjs';

const repository = 'owner/cleartier';
function release(version, notes = 'Release notes') {
  return {
    tag_name: `v${version}`,
    draft: false,
    prerelease: version.includes('-'),
    published_at: '2026-01-01T00:00:00Z',
    body: notes,
    assets: ['latest.json', 'cleartier-windows-x64.zip', `ClearTier_${version}_x64-setup.exe`].map(
      (name) => ({
        name,
        state: 'uploaded',
        size: 42,
        browser_download_url: `https://github.com/${repository}/releases/download/v${version}/${name}`,
      }),
    ),
  };
}
async function fixture(t, pages) {
  const directory = mkdtempSync(join(tmpdir(), 'cleartier-index-'));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const requests = [];
  let failure = false;
  const server = createServer((req, res) => {
    requests.push({ url: req.url, authorization: req.headers.authorization });
    res.writeHead(failure ? 403 : 200, { 'Content-Type': 'application/json' });
    const page = Number(new URL(req.url, 'http://localhost').searchParams.get('page'));
    res.end(JSON.stringify(failure ? { message: 'Forbidden' } : pages[page - 1]));
  });
  server.listen(0, '127.0.0.1');
  await new Promise((resolve) => server.once('listening', resolve));
  t.after(() => new Promise((resolve) => server.close(resolve)));
  const options = {
    directory,
    repository,
    token: 'index-test-token',
    apiUrl: `http://127.0.0.1:${server.address().port}`,
  };
  return {
    options,
    requests,
    fail: () => {
      failure = true;
    },
  };
}

test('publisher and native reader share a channel contract and compare SemVer instead of dates', async (t) => {
  const releases = [
    release('0.2.0-beta.10', 'Preview release'),
    release('0.1.0', 'Stable release'),
    release('0.2.0-beta.9'),
    release('0.0.9'),
  ];
  releases[3].published_at = '2099-01-01T00:00:00Z';
  const { options, requests } = await fixture(t, [releases]);
  const index = await generateUpdateIndex(options);
  const contract = JSON.parse(
    readFileSync(new URL('./fixtures/update-index.json', import.meta.url)),
  );
  assert.deepEqual(index, contract);
  assert.deepEqual(
    JSON.parse(readFileSync(join(options.directory, 'updates/updates.json'))),
    contract,
  );
  assert.equal(requests.length, 1);
  assert.equal(requests[0].authorization, 'Bearer index-test-token');
});

test('an RC-only repository has an empty stable channel; stable promotion updates both channels', async (t) => {
  const releases = [release('0.1.0-rc.1')];
  const { options } = await fixture(t, [releases]);
  let index = await generateUpdateIndex(options);
  assert.equal(index.stable, null);
  assert.equal(index.preview.version, '0.1.0-rc.1');
  releases.push(release('0.1.0'));
  index = await generateUpdateIndex(options);
  assert.equal(index.stable.version, '0.1.0');
  assert.equal(index.preview.version, '0.1.0');
});

test('drafts, unpublished, mismatched channels, noncanonical versions and incomplete packages are excluded', async (t) => {
  const invalid = [
    { ...release('9.0.0'), draft: true },
    { ...release('8.0.0'), published_at: null },
    { ...release('7.0.0'), prerelease: true },
    { ...release('6.0.0-rc.1'), prerelease: false },
    release('05.0.0'),
    release('4.0.0+build'),
    { ...release('3.0.0'), assets: [] },
  ];
  for (const mutation of ['missing', 'wrong-url', 'uploading', 'empty', 'duplicate']) {
    const value = release('2.0.0');
    if (mutation === 'missing') value.assets.pop();
    if (mutation === 'wrong-url')
      value.assets[0].browser_download_url = 'https://example.invalid/latest.json';
    if (mutation === 'uploading') value.assets[1].state = 'new';
    if (mutation === 'empty') value.assets[2].size = 0;
    if (mutation === 'duplicate') value.assets.push(value.assets[0]);
    invalid.push(value);
  }
  const { options } = await fixture(t, [[...invalid, release('0.1.0')]]);
  const index = await generateUpdateIndex(options);
  assert.equal(index.stable.version, '0.1.0');
  assert.equal(index.preview.version, '0.1.0');
});

test('pagination includes older pages and each rebuild reflects withdrawal without retaining stale pointers', async (t) => {
  const pages = [
    Array.from({ length: 100 }, () => ({ ...release('9.0.0'), draft: true })),
    [release('0.1.0')],
  ];
  const { options, requests } = await fixture(t, pages);
  assert.equal((await generateUpdateIndex(options)).stable.version, '0.1.0');
  assert.equal(requests.length, 2);
  pages[1] = [];
  assert.deepEqual(await generateUpdateIndex(options), {
    schemaVersion: 1,
    stable: null,
    preview: null,
  });
});

test('a failed source request never replaces an existing index or exposes credentials in errors', async (t) => {
  const { options, fail } = await fixture(t, [[]]);
  mkdirSync(join(options.directory, 'updates'));
  const file = join(options.directory, 'updates/updates.json');
  writeFileSync(file, 'previous index');
  fail();
  await assert.rejects(
    generateUpdateIndex(options),
    /Unable to read published releases \(HTTP 403\)/,
  );
  assert.equal(readFileSync(file, 'utf8'), 'previous index');
});

test('release notes remain valid Unicode within the native reader size limit', async (t) => {
  const { options } = await fixture(t, [[release('0.1.0', '😀'.repeat(20000))]]);
  const index = await generateUpdateIndex(options);
  assert.equal([...index.stable.notes].length, 16384);
  assert.equal(index.stable.notes, '😀'.repeat(16384));
});
