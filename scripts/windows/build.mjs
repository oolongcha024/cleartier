import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyWindowsIcon } from '../verify-windows-icon.mjs';
import { checkProjectVersion } from '../version.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const target = 'x86_64-pc-windows-msvc';
const output = join(root, 'artifacts/windows-x64');
const stage = join(root, '.cache/windows-native/ClearTier');
const checks = join(output, 'checks');
const resources = join(root, 'src-tauri/resources/windows');
const usage =
  'Usage: pnpm build:windows [exe|nsis|all]\nNative Windows x64 build; exe exports a complete portable ZIP. Default: all.';

function run(command, args, env = process.env) {
  // pnpm is a Windows command script. All its arguments here are fixed by this
  // program; paths and other data go directly to executables without a shell.
  const executable = command === 'pnpm' ? process.env.ComSpec || 'cmd.exe' : command;
  const parameters = command === 'pnpm' ? ['/d', '/s', '/c', 'pnpm', ...args] : args;
  const result = spawnSync(executable, parameters, { cwd: root, stdio: 'inherit', env });
  if (result.error) throw result.error;
  if (result.status !== 0)
    throw new Error(`${command} failed (exit ${result.status ?? 'unknown'}).`);
}

function capture(command, args) {
  return execFileSync(command, args, { cwd: root, encoding: 'utf8' }).trim();
}

function checksum(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

// ZIP and NSIS share one resource whitelist, owned by the bundle configuration.
export function stageProgram(executable, destination, projectRoot) {
  rmSync(destination, { recursive: true, force: true });
  mkdirSync(destination, { recursive: true });
  copyFileSync(executable, join(destination, 'cleartier.exe'));
  const config = JSON.parse(
    readFileSync(join(projectRoot, 'src-tauri/tauri.windows.conf.json'), 'utf8'),
  );
  for (const [source, targetPath] of Object.entries(config.bundle.resources)) {
    cpSync(resolve(projectRoot, 'src-tauri', source), join(destination, targetPath), {
      recursive: true,
    });
  }
}

function verifyProgram() {
  const executable = join(stage, 'cleartier.exe');
  verifyWindowsIcon(readFileSync(executable), readFileSync(join(root, 'src-tauri/icons/icon.ico')));
  const manifest = JSON.parse(readFileSync(join(resources, 'core-resources.json'), 'utf8'));
  for (const file of manifest.files) {
    if (checksum(join(stage, file.path)) !== file.sha256)
      throw new Error(`Resource hash mismatch: ${file.path}`);
  }
  for (const mode of ['Direct', 'Process', 'Recovery', 'MissingResource']) {
    const report = join(checks, `${mode}.json`);
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(root, 'scripts/check-core.ps1'),
      '-AppDirectory',
      stage,
      '-Mode',
      mode,
      '-ReportPath',
      report,
    ]);
    const result = JSON.parse(readFileSync(report, 'utf8').replace(/^\uFEFF/, ''));
    if (result.passed !== true || result.error || result.cleanupError)
      throw new Error(`${mode} core check failed.`);
  }
}

function exportOutputs(mode, release, version) {
  const files = [];
  const portable = join(output, 'exe');
  const zip = join(output, 'cleartier-windows-x64.zip');
  if (mode !== 'nsis') {
    rmSync(portable, { recursive: true, force: true });
    cpSync(stage, portable, { recursive: true });
    run('powershell.exe', [
      '-NoProfile',
      '-NonInteractive',
      '-ExecutionPolicy',
      'Bypass',
      '-File',
      join(root, 'scripts/windows/zip.ps1'),
      '-Source',
      stage,
      '-Destination',
      zip,
    ]);
    files.push('cleartier-windows-x64.zip');
  }
  if (mode !== 'exe') {
    const directory = join(release, 'bundle/nsis');
    const installers = readdirSync(directory).filter((name) => name.endsWith('-setup.exe'));
    if (installers.length !== 1)
      throw new Error(`Expected one new NSIS installer, found ${installers.length}.`);
    const destination = join(output, 'nsis');
    rmSync(destination, { recursive: true, force: true });
    mkdirSync(destination, { recursive: true });
    copyFileSync(join(directory, installers[0]), join(destination, installers[0]));
    copyFileSync(
      join(directory, `${installers[0]}.sig`),
      join(destination, `${installers[0]}.sig`),
    );
    files.push(`nsis/${installers[0]}`);
    run('cargo', [
      'run',
      '--locked',
      '--manifest-path',
      join(root, 'src-tauri/Cargo.toml'),
      '-p',
      'cleartier-updates',
      '--bin',
      'update-manifest',
      '--',
      join(root, 'src-tauri/tauri.conf.json'),
      join(destination, installers[0]),
      version.version,
      join(output, 'latest.json'),
    ]);
    files.push('latest.json');
  }
  const config = JSON.parse(readFileSync(join(root, 'src-tauri/tauri.conf.json'), 'utf8'));
  const manifest = {
    product: config.productName,
    version: version.version,
    channel: version.channel,
    target,
    mode,
    builtAt: new Date().toISOString(),
    signing: { authenticode: false, updater: mode !== 'exe' },
    source: { commit: capture('git', ['rev-parse', 'HEAD']), ref: process.env.GITHUB_REF ?? null },
    builder: {
      os: process.platform,
      arch: process.arch,
      node: process.version,
      rust: capture('rustc', ['--version']),
      protoc: capture('protoc', ['--version']),
      image: process.env.ImageOS ?? null,
      imageVersion: process.env.ImageVersion ?? null,
      runUrl:
        process.env.GITHUB_ACTIONS === 'true'
          ? `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`
          : null,
    },
    core: JSON.parse(readFileSync(join(resources, 'core-resources.json'), 'utf8')),
    checks: ['Direct', 'Process', 'Recovery', 'MissingResource'],
    files: files.map((path) => ({
      path,
      size: statSync(join(output, path)).size,
      sha256: checksum(join(output, path)),
    })),
  };
  writeFileSync(join(output, 'build-info.json'), JSON.stringify(manifest, null, 2) + '\n');
  for (const file of manifest.files) console.log(`Exported ${file.path} (${file.size} bytes)`);
}

export function main(args = process.argv.slice(2).filter((arg) => arg !== '--')) {
  if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
    console.log(usage);
    return;
  }
  const mode = args[0] ?? 'all';
  if (args.length > 1 || !['exe', 'nsis', 'all'].includes(mode)) throw new Error(usage);
  if (process.platform !== 'win32' || process.arch !== 'x64') {
    throw new Error(
      'Native builds require Windows x64. Use the manual GitHub Actions Windows build from Linux.',
    );
  }
  const versionOptions = {
    releaseTag: process.env.GITHUB_REF?.startsWith('refs/tags/')
      ? process.env.GITHUB_REF.slice(10)
      : undefined,
  };
  const version = checkProjectVersion(root, versionOptions);
  if (mode !== 'exe' && !process.env.TAURI_SIGNING_PRIVATE_KEY) {
    throw new Error(
      'NSIS update signing requires TAURI_SIGNING_PRIVATE_KEY (key content or path). Configure the repository secret or local environment.',
    );
  }
  mkdirSync(checks, { recursive: true });
  for (const name of readdirSync(checks)) {
    if (name !== 'environment.txt') rmSync(join(checks, name), { recursive: true, force: true });
  }
  // No stale successful package may be uploaded if a rebuild or check fails.
  for (const name of ['build-info.json', 'cleartier-windows-x64.zip', 'latest.json'])
    rmSync(join(output, name), { force: true });
  rmSync(join(output, 'nsis'), { recursive: true, force: true });
  rmSync(join(output, 'exe'), { recursive: true, force: true });
  run('pnpm', ['format:check']);
  run('pnpm', ['typecheck']);
  run('pnpm', ['test']);
  run('cargo', [
    'test',
    '--locked',
    '--manifest-path',
    join(root, 'src-tauri/Cargo.toml'),
    '-p',
    'cleartier-config',
  ]);
  run('cargo', [
    'test',
    '--locked',
    '--manifest-path',
    join(root, 'src-tauri/Cargo.toml'),
    '-p',
    'cleartier-updates',
  ]);
  run(process.execPath, [join(root, 'scripts/prepare-core-resources.mjs')]);
  // Native test executables also link the upstream runtime DLLs. Scope their
  // search path to this one command; the packaged application uses its own files.
  const testEnvironment = Object.fromEntries(
    Object.entries(process.env).filter(([key]) => key.toUpperCase() !== 'PATH'),
  );
  testEnvironment.PATH = `${resources};${process.env.PATH ?? ''}`;
  run(
    'cargo',
    [
      'test',
      '--locked',
      '--manifest-path',
      join(root, 'src-tauri/Cargo.toml'),
      '-p',
      'cleartier-core',
      '--lib',
    ],
    testEnvironment,
  );
  const metadata = JSON.parse(
    capture('cargo', [
      'metadata',
      '--locked',
      '--no-deps',
      '--format-version',
      '1',
      '--manifest-path',
      join(root, 'src-tauri/Cargo.toml'),
    ]),
  );
  const release = join(metadata.target_directory, target, 'release');
  rmSync(join(release, 'bundle/nsis'), { recursive: true, force: true });
  run('pnpm', [
    'tauri',
    'build',
    '--ci',
    '--target',
    target,
    ...(mode === 'exe' ? ['--no-bundle'] : ['--bundles', 'nsis']),
    '--',
    '--locked',
  ]);
  stageProgram(join(release, 'cleartier.exe'), stage, root);
  verifyProgram();
  if (checkProjectVersion(root, versionOptions).version !== version.version)
    throw new Error('Application version changed during the build. Rebuild with a fixed version.');
  exportOutputs(mode, release, version);
}

export function runCli() {
  try {
    main();
  } catch (error) {
    console.error(error.stack ?? error.message);
    if (process.platform === 'win32') {
      mkdirSync(checks, { recursive: true });
      writeFileSync(join(checks, 'build-error.txt'), `${error.stack ?? error.message}\n`);
    }
    process.exitCode = 1;
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) runCli();
