import { spawn } from 'node:child_process';
import { readFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { devEnvironment } from './dev-environment.ts';

const root = fileURLToPath(new URL('../', import.meta.url));
const url = `${devEnvironment().devUrl}/`;
const cli = process.env.AGENT_BROWSER_BIN ?? 'agent-browser';
const suites = [
  ['route-transitions'],
  ['navigation-overflow'],
  ['about-versions'],
  ['snackbar-dismissal'],
  ['network-editor-session'],
  ['advanced-disclosure', [], true],
  ['dashboard-telemetry', ['native-telemetry']],
  ['peer-icons', ['native-telemetry']],
  ['peer-disclosure', ['native-telemetry']],
  ['official-configuration', ['native-telemetry', 'native-configuration']],
  ['invitations', ['native-telemetry', 'native-invitations']],
  ['desktop-lifecycle', ['native-telemetry', 'native-desktop']],
  ['diagnostics', ['native-telemetry', 'native-desktop']],
  ['updates', ['native-telemetry', 'native-desktop', 'native-updates']],
];
const requested = process.argv.slice(2);
const chosen = requested.length ? suites.filter(([name]) => requested.includes(name)) : suites;
if (requested.some((name) => !suites.some(([suite]) => suite === name)))
  throw new Error('Unknown browser suite');
function command(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, args, { cwd: root, stdio: ['pipe', 'pipe', 'pipe'] });
    let out = '',
      err = '';
    child.stdout.on('data', (bytes) => {
      out += bytes;
    });
    child.stderr.on('data', (bytes) => {
      err += bytes;
    });
    child.on('error', reject);
    child.on('exit', (code) =>
      code === 0 ? resolve(out.trim()) : reject(new Error(`${args.join(' ')}\n${out}\n${err}`)),
    );
    child.stdin.end(input);
  });
}
async function available() {
  try {
    return (await fetch(url, { signal: AbortSignal.timeout(1000) })).ok;
  } catch {
    return false;
  }
}
let server;
await mkdir(join(root, '.cache/browser'), { recursive: true });
try {
  if (!(await available())) {
    server = spawn(process.execPath, [join(root, 'node_modules/vite/bin/vite.js')], {
      cwd: root,
      stdio: 'ignore',
    });
    const deadline = Date.now() + 15000;
    while (!(await available())) {
      if (Date.now() > deadline || server.exitCode !== null)
        throw new Error(`Preview did not start at ${url}`);
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  for (const [name, fixtures = [], editor = false] of chosen) {
    const session = `cleartier-check-${process.pid}-${name}`;
    const args = ['--session', session];
    try {
      const init = fixtures.flatMap((fixture) => [
        '--init-script',
        join(root, `tests/browser/fixtures/${fixture}.js`),
      ]);
      await command([...args, ...init, 'open', url]);
      await command([
        ...args,
        'set',
        'viewport',
        process.env.BROWSER_WIDTH ?? '1200',
        process.env.BROWSER_HEIGHT ?? '800',
      ]);
      const media = [
        process.env.BROWSER_COLOR_SCHEME,
        process.env.BROWSER_REDUCED_MOTION === 'reduce' ? 'reduced-motion' : undefined,
      ].filter(Boolean);
      if (media.length) await command([...args, 'set', 'media', ...media]);
      await command([
        ...args,
        'wait',
        '--fn',
        "Boolean(document.querySelector('.connection-card'))",
      ]);
      if (editor) {
        await command(
          [...args, 'eval', '--stdin'],
          'document.querySelector(\'.quick-actions button[aria-label^="编辑"]\').click()',
        );
        await command([
          ...args,
          'wait',
          '--fn',
          'Boolean(document.querySelector(\'.network-editor input[name="alias"]\'))',
        ]);
      }
      const output = await command(
        [...args, 'eval', '--stdin'],
        await readFile(join(root, `tests/browser/${name}.js`), 'utf8'),
      );
      const result = JSON.parse(output);
      if (result.passed !== true) throw new Error(`Suite did not report success: ${output}`);
      console.log(`PASS ${name}`);
    } catch (error) {
      await command([...args, 'screenshot', join(root, `.cache/browser/${name}.png`)]).catch(
        () => {},
      );
      throw error;
    } finally {
      await command([...args, 'close']).catch(() => {});
    }
  }
} finally {
  server?.kill('SIGTERM');
}
