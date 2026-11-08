import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import { changeProjectVersion, checkProjectVersion, main } from '../scripts/version.mjs';

const script = fileURLToPath(new URL('../scripts/version.mjs', import.meta.url));
const tracked = [
  'package.json',
  'src-tauri/Cargo.toml',
  'src-tauri/Cargo.lock',
  'src-tauri/tauri.conf.json',
];
function git(root, ...args) {
  return execFileSync(
    'git',
    [
      '-c',
      'commit.gpgsign=false',
      '-c',
      'tag.gpgsign=false',
      '-c',
      `core.hooksPath=${join(root, '.git/hooks')}`,
      ...args,
    ],
    { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] },
  ).trim();
}
function commit(root) {
  git(root, 'add', '.');
  git(
    root,
    '-c',
    'user.name=Version test',
    '-c',
    'user.email=version@example.invalid',
    'commit',
    '-qm',
    'fixture',
  );
}
function fixture(t, version = '0.1.0') {
  const root = mkdtempSync(join(tmpdir(), 'cleartier-version-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'src-tauri'));
  writeFileSync(
    join(root, 'package.json'),
    JSON.stringify({ name: 'cleartier', version }, null, 2) + '\n',
  );
  writeFileSync(
    join(root, 'src-tauri/Cargo.toml'),
    `[package]\nname = "cleartier"\nversion = "${version}" # application\n\n[dependencies]\nexample = { version = "0.1.0" }\n`,
  );
  writeFileSync(
    join(root, 'src-tauri/Cargo.lock'),
    `# generated\nversion = 4\n\n[[package]]\nname = "cleartier"\nversion = "${version}"\ndependencies = ["example"]\n\n[[package]]\nname = "cleartier-core"\nversion = "0.1.0"\n\n[[package]]\nname = "example"\nversion = "0.1.0"\n`,
  );
  writeFileSync(
    join(root, 'src-tauri/tauri.conf.json'),
    JSON.stringify({ version: '../package.json' }),
  );
  writeFileSync(join(root, '.gitignore'), '.version.lock\n*.version-*.tmp\n');
  git(root, 'init', '-q', '-b', 'main');
  commit(root);
  return root;
}
function snapshot(root) {
  return tracked.map((path) => readFileSync(join(root, path), 'utf8'));
}
function rejectUnchanged(root, command, args, pattern) {
  const before = snapshot(root);
  assert.throws(() => changeProjectVersion(root, command, args), pattern);
  assert.deepEqual(snapshot(root), before);
  assert.equal(existsSync(join(root, '.version.lock')), false);
}

test('full release train advances numerically and synchronizes only application versions', (t) => {
  const root = fixture(t);
  const original = snapshot(root);
  assert.equal(changeProjectVersion(root, 'start', ['minor', 'alpha']).version, '0.2.0-alpha.1');
  for (let index = 2; index <= 10; index++)
    assert.equal(changeProjectVersion(root, 'next').version, `0.2.0-alpha.${index}`);
  assert.equal(changeProjectVersion(root, 'promote', ['beta']).version, '0.2.0-beta.1');
  for (let index = 2; index <= 10; index++)
    assert.equal(changeProjectVersion(root, 'next').version, `0.2.0-beta.${index}`);
  assert.equal(changeProjectVersion(root, 'promote', ['rc']).version, '0.2.0-rc.1');
  assert.equal(changeProjectVersion(root, 'promote', ['stable']).version, '0.2.0');
  assert.deepEqual(checkProjectVersion(root), { version: '0.2.0', channel: 'stable' });
  const final = snapshot(root);
  assert.equal(
    final[1],
    original[1].replace('version = "0.1.0" # application', 'version = "0.2.0" # application'),
  );
  assert.equal(
    final[2],
    original[2].replace(
      'name = "cleartier"\nversion = "0.1.0"',
      'name = "cleartier"\nversion = "0.2.0"',
    ),
  );
  assert.equal(final[3], original[3]);
  rejectUnchanged(root, 'next', [], /Stable versions/);
  rejectUnchanged(root, 'set', ['0.2.0-alpha.99'], /must advance/);
});

for (const [version, command, args, expected] of [
  ['0.1.0', 'start', ['patch'], '0.1.1-alpha.1'],
  ['0.1.0', 'start', ['minor', 'beta'], '0.2.0-beta.1'],
  ['0.1.0', 'start', ['major', 'rc'], '1.0.0-rc.1'],
  ['0.1.0', 'start', ['patch', 'stable'], '0.1.1'],
  ['0.2.0-alpha.5', 'start', ['minor'], '0.3.0-alpha.1'],
  ['0.2.0-alpha.5', 'promote', ['rc'], '0.2.0-rc.1'],
  ['0.2.0-alpha.5', 'promote', ['stable'], '0.2.0'],
  ['0.1.0', 'set', ['0.3.0-beta.2'], '0.3.0-beta.2'],
])
  test(`${command} ${args.join(' ')} from ${version}`, (t) => {
    const root = fixture(t, version);
    assert.equal(changeProjectVersion(root, command, args).version, expected);
    assert.equal(checkProjectVersion(root).version, expected);
  });

test('rejected versions and transitions never modify files', (t) => {
  const root = fixture(t, '0.2.0-beta.9');
  for (const version of [
    '0.2.0-beta.9',
    '0.2.0-beta.8',
    '0.2.0-alpha.999',
    '0.1.9',
    'v0.3.0',
    ' 0.3.0',
    '0.3.0+build.2',
    '0.3.0-alpha',
    '0.3.0-alpha.0',
    '0.3.0-alpha.01',
    '0.3.0-preview.1',
    '0.3.0-alpha.1.extra',
    '0.3.0-rc.9007199254740992',
  ]) {
    rejectUnchanged(root, 'set', [version], /must advance|Invalid application version/);
  }
  for (const stage of ['alpha', 'beta', 'preview'])
    rejectUnchanged(root, 'promote', [stage], /Promotion requires/);
  rejectUnchanged(root, 'start', ['minor', 'preview'], /Usage/);
  rejectUnchanged(root, 'start', ['minor', 'alpha', 'extra'], /Usage/);
  rejectUnchanged(root, 'next', ['extra'], /Usage/);
  rejectUnchanged(root, 'unknown', [], /Usage/);
});

test('dry run computes the same version without writes and cannot bypass validation', (t) => {
  const root = fixture(t);
  const before = snapshot(root);
  assert.deepEqual(changeProjectVersion(root, 'start', ['minor'], { dryRun: true }), {
    previous: '0.1.0',
    version: '0.2.0-alpha.1',
    dryRun: true,
  });
  assert.deepEqual(snapshot(root), before);
  assert.equal(git(root, 'status', '--porcelain'), '');
  assert.throws(
    () => changeProjectVersion(root, 'set', ['0.1.0-alpha.1'], { dryRun: true }),
    /must advance/,
  );
});

for (const [file, transform, pattern] of [
  ['package.json', (source) => source.replace('0.1.0', '0.2.0'), /differs/],
  ['src-tauri/Cargo.toml', (source) => source.replace('0.1.0', '0.2.0'), /differs/],
  [
    'src-tauri/Cargo.lock',
    (source) => source.replace('version = "0.1.0"', 'version = "0.2.0"'),
    /differs/,
  ],
  ['src-tauri/tauri.conf.json', () => '{"version":"0.1.0"}', /must reference/],
  [
    'src-tauri/Cargo.toml',
    (source) => source.replace('name = "cleartier"', 'name = "other"'),
    /exactly one/,
  ],
  [
    'src-tauri/Cargo.lock',
    (source) => source + '\n[[package]]\nname = "cleartier"\nversion = "0.1.0"\n',
    /exactly one/,
  ],
])
  test(`inconsistent ${file} blocks check and change`, (t) => {
    const root = fixture(t);
    const path = join(root, file);
    writeFileSync(path, transform(readFileSync(path, 'utf8')));
    assert.throws(() => checkProjectVersion(root), pattern);
    rejectUnchanged(root, 'start', ['minor'], pattern);
  });

test('an active or interrupted transaction blocks checks and writes', (t) => {
  const root = fixture(t);
  writeFileSync(join(root, '.version.lock'), '');
  const before = snapshot(root);
  assert.throws(() => checkProjectVersion(root), /locked/);
  assert.throws(() => changeProjectVersion(root, 'start', ['minor']), /locked/);
  assert.throws(() => changeProjectVersion(root, 'start', ['minor'], { dryRun: true }), /locked/);
  assert.deepEqual(snapshot(root), before);
  assert.equal(existsSync(join(root, '.version.lock')), true);
});

test('published tags prevent duplicate and out-of-order releases in the same release line', (t) => {
  const root = fixture(t);
  git(root, 'tag', 'v0.2.0-beta.10');
  rejectUnchanged(root, 'set', ['0.2.0-beta.10'], /published/);
  rejectUnchanged(root, 'set', ['0.2.0-beta.9'], /published/);
  assert.equal(changeProjectVersion(root, 'set', ['0.2.0-beta.11']).version, '0.2.0-beta.11');
  git(root, 'tag', 'v0.2.1');
  rejectUnchanged(root, 'set', ['0.2.0'], /published/);
  assert.equal(changeProjectVersion(root, 'set', ['0.2.2-alpha.1']).version, '0.2.2-alpha.1');
});

test('maintenance release lines advance independently', (t) => {
  const root = fixture(t);
  git(root, 'tag', 'v0.2.0');
  git(root, 'tag', 'v1.0.0');
  git(root, 'tag', 'unrelated-tag');
  assert.equal(changeProjectVersion(root, 'start', ['patch']).version, '0.1.1-alpha.1');
});

test('CI base checks allow unchanged versions and reject downgrades or published candidates', (t) => {
  const root = fixture(t, '0.2.0-beta.10');
  const baseRef = git(root, 'rev-parse', 'HEAD');
  assert.equal(checkProjectVersion(root, { baseRef }).version, '0.2.0-beta.10');
  changeProjectVersion(root, 'next');
  assert.equal(checkProjectVersion(root, { baseRef }).version, '0.2.0-beta.11');
  git(root, 'tag', 'v0.2.0-beta.11');
  assert.throws(() => checkProjectVersion(root, { baseRef }), /published/);
  const newerRoot = fixture(t, '0.3.0');
  changeProjectVersion(newerRoot, 'start', ['minor']);
  commit(newerRoot);
  const newerBase = git(newerRoot, 'rev-parse', 'HEAD');
  git(newerRoot, 'checkout', '-q', 'HEAD~1');
  assert.throws(() => checkProjectVersion(newerRoot, { baseRef: newerBase }), /must advance/);
  assert.throws(() => checkProjectVersion(root, { baseRef: '--help' }), /Invalid base/);
});

test('initial adoption permits an unpublished placeholder to become a prerelease of the same base only', (t) => {
  function initialize(root, version) {
    for (const path of tracked.slice(0, 3)) {
      const file = join(root, path);
      writeFileSync(file, readFileSync(file, 'utf8').replace('"0.1.0"', `"${version}"`));
    }
  }
  const root = fixture(t);
  const baseRef = git(root, 'rev-parse', 'HEAD');
  initialize(root, '0.1.0-rc.1');
  assert.equal(checkProjectVersion(root, { baseRef }).version, '0.1.0-rc.1');
  git(root, 'tag', 'v0.1.0');
  assert.throws(() => checkProjectVersion(root, { baseRef }), /published/);

  const managed = fixture(t);
  const pkg = JSON.parse(readFileSync(join(managed, 'package.json'), 'utf8'));
  pkg.scripts = { 'version:check': 'node scripts/version.mjs check' };
  writeFileSync(join(managed, 'package.json'), JSON.stringify(pkg));
  commit(managed);
  const managedBase = git(managed, 'rev-parse', 'HEAD');
  initialize(managed, '0.1.0-rc.1');
  assert.throws(() => checkProjectVersion(managed, { baseRef: managedBase }), /must advance/);

  const differentBase = fixture(t);
  const differentBaseRef = git(differentBase, 'rev-parse', 'HEAD');
  initialize(differentBase, '0.0.9-rc.1');
  assert.throws(
    () => checkProjectVersion(differentBase, { baseRef: differentBaseRef }),
    /must advance/,
  );
});

test('release checks require an exact tag at HEAD and a clean checkout; historical tags remain buildable', (t) => {
  const root = fixture(t);
  const initial = git(root, 'rev-parse', 'HEAD');
  git(root, 'tag', 'v0.1.0');
  assert.equal(checkProjectVersion(root, { releaseTag: 'v0.1.0' }).version, '0.1.0');
  assert.throws(() => checkProjectVersion(root, { releaseTag: 'v0.2.0' }), /Release tag must be/);
  writeFileSync(join(root, 'untracked.txt'), 'pending');
  assert.throws(() => checkProjectVersion(root, { releaseTag: 'v0.1.0' }), /clean worktree/);
  rmSync(join(root, 'untracked.txt'));
  writeFileSync(join(root, 'committed.txt'), 'next commit');
  commit(root);
  assert.throws(() => checkProjectVersion(root, { releaseTag: 'v0.1.0' }), /point to HEAD/);
  changeProjectVersion(root, 'start', ['patch', 'stable']);
  commit(root);
  git(root, 'tag', 'v0.1.1');
  git(root, 'checkout', '-q', initial);
  assert.equal(checkProjectVersion(root, { releaseTag: 'v0.1.0' }).version, '0.1.0');
});

test('CLI validates arguments and exposes a no-write preview', (t) => {
  const root = fixture(t);
  const before = snapshot(root);
  main(['start', 'minor', '--dry-run'], root);
  assert.deepEqual(snapshot(root), before);
  for (const args of [
    ['check', '--base'],
    ['check', '--unknown', 'x'],
    ['check', '--base', 'HEAD', '--base', 'HEAD'],
    ['start', 'minor', '--dry-run', '--dry-run'],
  ])
    assert.throws(() => main(args, root), /Usage/);
  const env = { ...process.env, GITHUB_REF: '', VERSION_BASE_REF: '' };
  const result = spawnSync(process.execPath, [script, 'invalid'], { encoding: 'utf8', env });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Usage/);
  assert.deepEqual(snapshot(root), before);
});

test('CI environment enables base and tag validation, and skips the first-push zero SHA', (t) => {
  const root = fixture(t);
  const saved = {
    VERSION_BASE_REF: process.env.VERSION_BASE_REF,
    GITHUB_REF: process.env.GITHUB_REF,
  };
  try {
    process.env.VERSION_BASE_REF = '0000000000000000000000000000000000000000';
    process.env.GITHUB_REF = 'refs/heads/main';
    main(['check'], root);
    process.env.VERSION_BASE_REF = git(root, 'rev-parse', 'HEAD');
    changeProjectVersion(root, 'start', ['minor']);
    main(['check'], root);
    git(root, 'tag', 'v0.2.0-alpha.1');
    assert.throws(() => main(['check'], root), /published/);
    delete process.env.VERSION_BASE_REF;
    git(root, 'tag', '-d', 'v0.2.0-alpha.1');
    commit(root);
    git(root, 'tag', 'v0.2.0-alpha.1');
    process.env.GITHUB_REF = 'refs/tags/v0.2.0-alpha.1';
    main(['check'], root);
    process.env.GITHUB_REF = 'refs/tags/v0.2.0';
    assert.throws(() => main(['check'], root), /Release tag must be/);
  } finally {
    for (const [key, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
});
