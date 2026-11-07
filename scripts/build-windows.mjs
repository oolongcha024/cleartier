import { execFileSync, spawnSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const args = process.argv.slice(2).filter(arg => arg !== '--');
const usage = `Usage: pnpm build:windows [exe|nsis|all]

  exe   Build the Windows x64 program without an installer.
  nsis  Build the Windows x64 NSIS installer.
  all   Export both outputs (default).

Outputs: artifacts/windows-x64/
Requires a Linux x64 Podman host. The toolchain stays in the container.`;

if (args.length === 1 && ['--help', '-h'].includes(args[0])) {
  console.log(usage);
  process.exit(0);
}

const mode = args[0] ?? 'all';
if (args.length > 1 || !['exe', 'nsis', 'all'].includes(mode)) {
  console.error(usage);
  process.exit(2);
}

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const image = 'localhost/cleartier-windows-builder:0.1';
const cache = join(projectRoot, '.cache/windows-builder');
// Host networking also works with the remote host's transparent proxy/TUN routing.
const network = process.env.CLEARTIER_WINDOWS_NETWORK ?? 'host';

function run(commandArgs) {
  const result = spawnSync('podman', commandArgs, { cwd: projectRoot, stdio: 'inherit' });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

try {
  const info = JSON.parse(execFileSync('podman', ['info', '--format', 'json'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'inherit'],
  }));
  if (info.host.os !== 'linux' || info.host.arch !== 'amd64') {
    throw new Error('This builder currently requires a Linux x64 Podman host.');
  }

  run(['build', '--pull=missing', '--file', 'containers/windows/Containerfile',
    '--tag', image, 'containers/windows']);

  const imageId = execFileSync('podman', ['image', 'inspect', image, '--format', '{{.Id}}'], {
    encoding: 'utf8',
  }).trim();
  for (const dir of ['node_modules', 'dist', 'target']) mkdirSync(join(cache, dir), { recursive: true });

  const mountLabel = info.host.security.selinuxEnabled ? ':Z' : '';
  run([
    'run', '--rm', '--userns=keep-id', '--network', network,
    '--volume', `${projectRoot}:/workspace${mountLabel}`,
    '--volume', `${cache}:/cache${mountLabel}`,
    '--volume', `${join(cache, 'node_modules')}:/workspace/node_modules${mountLabel}`,
    '--volume', `${join(cache, 'dist')}:/workspace/dist${mountLabel}`,
    '--volume', `${join(cache, 'target')}:/workspace/src-tauri/target${mountLabel}`,
    '--env', 'CARGO_HOME=/cache/cargo',
    '--env', 'XWIN_CACHE_DIR=/cache/xwin',
    '--env', 'XDG_CACHE_HOME=/cache/xdg',
    '--env', 'XDG_DATA_HOME=/cache/data',
    '--env', 'XDG_STATE_HOME=/cache/state',
    '--env', `CLEARTIER_BUILDER_IMAGE=${imageId}`,
    image, mode,
  ]);
} catch (error) {
  console.error(`Windows build failed: ${error.message}`);
  process.exit(1);
}
