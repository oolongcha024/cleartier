import { readFileSync } from 'node:fs';
import { isIP } from 'node:net';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));

export interface DevEnvironmentOptions {
  root?: string;
  env?: NodeJS.ProcessEnv;
}

/** One address for the frontend, hot reload, desktop and browser checks. */
export function devEnvironment({
  root = projectRoot,
  env = process.env,
}: DevEnvironmentOptions = {}) {
  let configured = env.CLEARTIER_DEV_HOST;
  if (configured === undefined) {
    try {
      configured = parseEnv(readFileSync(join(root, '.env.local'), 'utf8')).CLEARTIER_DEV_HOST;
    } catch (error) {
      if (!(error instanceof Error && 'code' in error && error.code === 'ENOENT')) throw error;
    }
  }
  const value = (configured ?? 'localhost').trim().toLowerCase();
  const host =
    value.startsWith('[') && value.endsWith(']') && isIP(value.slice(1, -1)) === 6
      ? value.slice(1, -1)
      : value;
  const hostname =
    host.length <= 253 &&
    !/^[\d.]+$/.test(host) &&
    host
      .replace(/\.$/, '')
      .split('.')
      .every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/i.test(label));
  const urlHost = isIP(host) === 6 ? new URL(`http://[${host}]`).hostname : host;
  if ((!isIP(host) && !hostname) || host === '0.0.0.0' || urlHost === '[::]') {
    throw new Error(
      'CLEARTIER_DEV_HOST must be a concrete hostname or IP address, without a protocol, port or path.',
    );
  }
  const port = 5173;
  const previewPort = 4174;
  return {
    host,
    port,
    previewPort,
    devUrl: `http://${urlHost}:${port}`,
    previewUrl: `http://${urlHost}:${previewPort}`,
  };
}
