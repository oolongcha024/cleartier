import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { run } from '@tauri-apps/cli';
import { devEnvironment } from './dev-environment.ts';

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
  const { devUrl } = devEnvironment(options);
  // Merge after custom config, before any runner/application arguments.
  return [...cliArgs, '--config', JSON.stringify({ build: { devUrl } }), ...args.slice(boundary)];
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await run(tauriArguments(process.argv.slice(2)), 'pnpm tauri');
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
