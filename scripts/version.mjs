import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { existsSync, openSync, closeSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import semver from 'semver';

const stages = ['alpha', 'beta', 'rc', 'stable'];
const files = ['package.json', 'src-tauri/Cargo.toml', 'src-tauri/Cargo.lock'];
const usage = `Usage: pnpm version:<command> [arguments] [--dry-run]
  start <patch|minor|major> [alpha|beta|rc|stable]  Start the next version (default: alpha.1)
  next                                           Increment the prerelease number
  promote <beta|rc|stable>                        Advance the prerelease stage
  set <version>                                  Set a strictly newer version
  check [--base <git-ref>] [--release <tag>]       Check consistency and release history
Builds only check versions. These commands never create commits or tags.`;

function parseVersion(value) {
  const parsed = typeof value === 'string' ? semver.parse(value) : null;
  if (!parsed || parsed.version !== value || parsed.build.length ||
      (parsed.prerelease.length && (parsed.prerelease.length !== 2 ||
        !stages.slice(0, 3).includes(parsed.prerelease[0]) ||
        !Number.isSafeInteger(parsed.prerelease[1]) || parsed.prerelease[1] < 1))) {
    throw new Error(`Invalid application version: ${JSON.stringify(value)}. Use X.Y.Z or X.Y.Z-(alpha|beta|rc).N with N >= 1; no build metadata.`);
  }
  return parsed;
}

function git(root, args) {
  try {
    return execFileSync('git', args, { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
  } catch (error) {
    throw new Error(`Git check failed (${args[0]}). Use a Git checkout with the required history and tags.`, { cause: error });
  }
}

// Scope replacements to the application package. Dependency and workspace crate
// versions have separate lifecycles and must survive a product version change.
function packageVersionSlot(source, kind) {
  const sections = [...source.matchAll(kind === 'manifest'
    ? /^\[package\][^\S\r\n]*(?:\r?\n)[\s\S]*?(?=^\[|$(?![\s\S]))/gm
    : /^\[\[package\]\][^\S\r\n]*(?:\r?\n)[\s\S]*?(?=^\[\[package\]\]|$(?![\s\S]))/gm)]
    .filter(match => /^name\s*=\s*"cleartier"\s*$/m.test(match[0]));
  if (sections.length !== 1) throw new Error(`Expected exactly one cleartier package in Cargo.${kind === 'manifest' ? 'toml' : 'lock'}.`);
  const section = sections[0];
  const matches = [...section[0].matchAll(/^version\s*=\s*"([^"]+)"[^\S\r\n]*(?:#.*)?$/gm)];
  if (matches.length !== 1) throw new Error('Expected one application version in the Cargo package section.');
  const match = matches[0];
  const offset = section.index + match.index + match[0].indexOf('"') + 1;
  return { value: match[1], replace: value => source.slice(0, offset) + value + source.slice(offset + match[1].length) };
}

function assertUnlocked(root) {
  if (existsSync(join(root, '.version.lock'))) {
    throw new Error('Version update is locked. If a previous update was interrupted, inspect the version files and remove .version.lock after confirming no updater is running.');
  }
}

function inspect(root) {
  const sources = files.map(file => readFileSync(join(root, file), 'utf8'));
  const pkg = JSON.parse(sources[0]);
  const parsed = parseVersion(pkg.version);
  const manifest = packageVersionSlot(sources[1], 'manifest');
  const lock = packageVersionSlot(sources[2], 'lock');
  for (const [name, actual] of [['Cargo.toml', manifest.value], ['Cargo.lock', lock.value]]) {
    if (actual !== pkg.version) throw new Error(`${name} version ${actual} differs from package.json ${pkg.version}. Restore consistency before continuing.`);
  }
  const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  if (config.version !== '../package.json') throw new Error('tauri.conf.json version must reference ../package.json.');
  return { sources, pkg, parsed, manifest, lock };
}

function assertNewer(root, current, next, { initializing = false } = {}) {
  if (!initializing && !semver.gt(next, current)) throw new Error(`Version must advance: ${current} → ${next}.`);
  const candidate = parseVersion(next);
  const tags = git(root, ['tag', '--list']).split('\n');
  for (const tag of tags) {
    if (!tag.startsWith('v')) continue;
    const published = semver.parse(tag.slice(1));
    if (published && published.major === candidate.major && published.minor === candidate.minor &&
        semver.gte(published, candidate)) {
      throw new Error(`${next} must be newer than published ${tag} in the same major.minor release line.`);
    }
  }
}

export function checkProjectVersion(root, { baseRef, releaseTag } = {}) {
  assertUnlocked(root);
  const { pkg, parsed } = inspect(root);
  if (baseRef) {
    if (baseRef.startsWith('-')) throw new Error('Invalid base Git reference.');
    const previousPackage = JSON.parse(git(root, ['show', `${baseRef}:package.json`]));
    const previous = parseVersion(previousPackage.version);
    // On initial adoption, an unpublished placeholder may become a prerelease
    // of the same base. Existing release tags still prohibit this transition.
    const initializing = !previousPackage.scripts?.['version:check'] && !previous.prerelease.length &&
      parsed.prerelease.length > 0 && previous.major === parsed.major &&
      previous.minor === parsed.minor && previous.patch === parsed.patch;
    if (previous.version !== pkg.version) assertNewer(root, previous.version, pkg.version, { initializing });
  }
  if (releaseTag) {
    if (releaseTag !== `v${pkg.version}`) throw new Error(`Release tag must be v${pkg.version}, received ${releaseTag}.`);
    if (git(root, ['rev-parse', '--verify', `refs/tags/${releaseTag}^{commit}`]) !== git(root, ['rev-parse', 'HEAD'])) {
      throw new Error('Release tag must point to HEAD.');
    }
    if (git(root, ['status', '--porcelain'])) throw new Error('Release builds require a clean worktree, including untracked files.');
  }
  return { version: pkg.version, channel: parsed.prerelease[0] ?? 'stable' };
}

function nextVersion(current, command, args) {
  const parsed = parseVersion(current);
  const base = `${parsed.major}.${parsed.minor}.${parsed.patch}`;
  let next;
  if (command === 'start' && args.length >= 1 && args.length <= 2) {
    const [increment, stage = 'alpha'] = args;
    if (!['patch', 'minor', 'major'].includes(increment) || !stages.includes(stage)) throw new Error(usage);
    next = semver.inc(base, increment);
    if (stage !== 'stable') next += `-${stage}.1`;
  } else if (command === 'next' && args.length === 0) {
    if (!parsed.prerelease.length) throw new Error('Stable versions have no prerelease number. Use version:start.');
    next = `${base}-${parsed.prerelease[0]}.${parsed.prerelease[1] + 1}`;
  } else if (command === 'promote' && args.length === 1) {
    const stage = args[0];
    if (!parsed.prerelease.length || !stages.includes(stage) || stages.indexOf(stage) <= stages.indexOf(parsed.prerelease[0])) {
      throw new Error('Promotion requires a prerelease and a later stage: alpha → beta → rc → stable.');
    }
    next = stage === 'stable' ? base : `${base}-${stage}.1`;
  } else if (command === 'set' && args.length === 1) {
    next = args[0];
  } else {
    throw new Error(usage);
  }
  parseVersion(next);
  return next;
}

export function changeProjectVersion(root, command, args = [], { dryRun = false } = {}) {
  assertUnlocked(root);
  const update = () => {
    const state = inspect(root);
    const next = nextVersion(state.pkg.version, command, args);
    assertNewer(root, state.pkg.version, next);
    if (!dryRun) {
      state.pkg.version = next;
      const replacements = [JSON.stringify(state.pkg, null, 2) + '\n', state.manifest.replace(next), state.lock.replace(next)];
      const temporary = files.map(file => join(root, `${file}.version-${randomUUID()}.tmp`));
      const written = [];
      try {
        for (let index = 0; index < files.length; index++) writeFileSync(temporary[index], replacements[index], { flag: 'wx' });
        for (let index = 0; index < files.length; index++) {
          renameSync(temporary[index], join(root, files[index]));
          written.push(index);
        }
      } catch (error) {
        for (const index of written) writeFileSync(join(root, files[index]), state.sources[index]);
        throw error;
      } finally {
        for (const file of temporary) rmSync(file, { force: true });
      }
    }
    return { previous: state.parsed.version, version: next, dryRun };
  };
  if (dryRun) return update();
  const lock = join(root, '.version.lock');
  // Exclusive creation also closes the race between the initial check and write.
  const descriptor = openSync(lock, 'wx');
  try { return update(); } finally { closeSync(descriptor); rmSync(lock); }
}

export function main(argv = process.argv.slice(2).filter(arg => arg !== '--'), root = fileURLToPath(new URL('../', import.meta.url))) {
  if (argv.length === 1 && ['--help', '-h'].includes(argv[0])) { console.log(usage); return; }
  const [command, ...args] = argv;
  if (command === 'check') {
    const options = {};
    for (let index = 0; index < args.length; index += 2) {
      if (!['--base', '--release'].includes(args[index]) || !args[index + 1] || args[index + 1].startsWith('--')) throw new Error(usage);
      const key = args[index] === '--base' ? 'baseRef' : 'releaseTag';
      if (options[key]) throw new Error(usage);
      options[key] = args[index + 1];
    }
    // CI supplies exact SHAs through environment variables, never shell code.
    options.baseRef ??= process.env.VERSION_BASE_REF || undefined;
    if (/^0+$/.test(options.baseRef ?? '')) options.baseRef = undefined;
    options.releaseTag ??= process.env.GITHUB_REF?.startsWith('refs/tags/') ? process.env.GITHUB_REF.slice(10) : undefined;
    const result = checkProjectVersion(root, options);
    console.log(`Version OK: ${result.version} (${result.channel})`);
  } else {
    const dryRun = args.includes('--dry-run');
    if (args.filter(arg => arg === '--dry-run').length > 1) throw new Error(usage);
    const result = changeProjectVersion(root, command, args.filter(arg => arg !== '--dry-run'), { dryRun });
    console.log(`${result.previous} → ${result.version}${dryRun ? ' (dry run; no files changed)' : ''}`);
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(); } catch (error) { console.error(error.message); process.exitCode = 1; }
}
