// Separate Vite development entry: the normal application never loads native fixtures.
import '../tests/browser/fixtures/native-telemetry.js';
import '../tests/browser/fixtures/native-desktop.js';
import '../tests/browser/fixtures/native-updates.js';

const test = window.__updateTest;
const select = document.querySelector('[aria-label="预览状态"]');
location.hash = '#/settings/about';

function show(state) {
  test.token++;
  test.hold = false;
  Object.assign(test.status, {
    distribution: state === 'portable' ? 'portable' : 'installed',
    phase: ['failed', 'signature', 'portable', 'indeterminate'].includes(state)
      ? {
          failed: 'idle',
          signature: 'available',
          portable: 'available',
          indeterminate: 'downloading',
        }[state]
      : state,
    candidate: [
      'available',
      'downloading',
      'indeterminate',
      'signature',
      'ready',
      'portable',
    ].includes(state)
      ? { version: '0.2.0-beta.10', notes: '更新预览' }
      : null,
    error: state === 'failed' ? 'network' : state === 'signature' ? 'signature' : null,
    lastChecked: state === 'idle' ? null : Math.floor(Date.now() / 1000),
    retryAt: null,
    downloaded: 42,
    total: state === 'indeterminate' ? null : 100,
  });
  test.emit();
}
show(select.value);
select.addEventListener('change', () => show(select.value));

// Let the actual update button demonstrate a complete download and confirmation.
setInterval(() => {
  if (test.status.phase !== 'downloading' || !test.hold) return;
  test.status.downloaded = Math.min(100, test.status.downloaded + 2);
  test.emit();
  if (test.status.downloaded === 100) test.hold = false;
}, 250);
const invoke = window.__TAURI_INTERNALS__.invoke;
window.__TAURI_INTERNALS__.invoke = (command, args) => {
  if (command === 'updates_command' && args?.command.action === 'update' && !args.command.confirmed)
    test.hold = true;
  return invoke(command, args);
};

await import('../src/main.tsx');
