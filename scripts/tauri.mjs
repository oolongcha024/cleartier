import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '@tauri-apps/cli';
import { devEnvironment, parseDevArguments } from './dev-environment.ts';

export function tauriArguments(args, options) {
  const separator = args.indexOf('--');
  const boundary = separator < 0 ? args.length : separator;
  const cliArgs = args.slice(0, boundary);
  const command = cliArgs.find((arg) => arg !== '--verbose' && !/^-v+$/.test(arg));
  if (
    command !== 'dev' ||
    cliArgs.some((arg) => ['--help', '-h', '--version', '-V'].includes(arg))
  ) {
    return args;
  }
  const { host, port, devUrl } = devEnvironment({ ...options, args: cliArgs });
  const { remaining } = parseDevArguments(cliArgs);
  // Host is validated as an IP/hostname and port as an integer before shell interpolation.
  const beforeDevCommand = `pnpm dev --host ${host} --port ${port}`;
  // Merge after custom config, before any runner/application arguments.
  return [
    ...remaining,
    '--config',
    JSON.stringify({ build: { devUrl, beforeDevCommand } }),
    ...args.slice(boundary),
  ];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run(tauriArguments(process.argv.slice(2)), 'pnpm tauri');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
