// Uses the shared development adapter with scene=testing.
// This checks UI/IPC integration; actual core counters are covered in Rust.
(async () => {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const waitFor = async (check) => {
    const deadline = performance.now() + 6000;
    while (!check()) {
      if (performance.now() > deadline) throw new Error('Dashboard condition timed out');
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  };
  assert(window.__CLEARTIER_DEV__.mock.networks, 'Select the shared development data source first');
  await waitFor(() =>
    [...document.querySelectorAll('.metric-value')].some((node) => node.innerText.includes('/s')),
  );
  assert(
    document.querySelector('.node-hostname').textContent === 'actual-test-node',
    'Actual node hostname missing',
  );
  const table = document.querySelector('.device-table');
  assert(table.querySelectorAll('th').length === 5, 'Loss rate must be a base column');
  assert(table.innerText.includes('1.2%'), 'Measured loss missing');
  assert(!table.innerText.includes('0.0ms'), 'Missing relay latency must not become zero');
  const peer = table.querySelector('.device-expand');
  peer.click();
  await waitFor(() => peer.getAttribute('aria-expanded') === 'true');
  assert(
    table.innerText.includes('UDP') && table.innerText.includes('2.6.4-test'),
    'Connection details missing',
  );
  window.__CLEARTIER_DEV__.mock.networks.fail = true;
  await waitFor(() => document.querySelector('.devices-card .data-status'));
  const totals = [...document.querySelectorAll('.traffic-total dd')].map((node) => node.innerText);
  assert(
    [...document.querySelectorAll('.metric-value')].every((node) => node.innerText === '—'),
    'Stale rates must be unknown',
  );
  assert(document.querySelectorAll('.device-expand').length === 2, 'Query failure erased peers');
  assert(
    !table.innerText.includes('1.2%') && !table.innerText.includes('23.5ms'),
    'Stale quality must be unknown',
  );
  assert(
    totals.every((value) => value !== '—'),
    'Query failure erased totals',
  );
  window.__CLEARTIER_DEV__.mock.networks.fail = false;
  await waitFor(() => !document.querySelector('.devices-card .data-status'));
  await waitFor(() =>
    [...document.querySelectorAll('.metric-value')].some((node) => node.innerText.includes('/s')),
  );
  assert(peer.getAttribute('aria-expanded') === 'true', 'Refresh collapsed a device');
  const disconnect = document.querySelector('.connection-state .button');
  disconnect.click();
  await waitFor(() => document.querySelector('.connection-state h3').textContent === '网络已断开');
  assert(
    document.querySelectorAll('.device-expand').length === 0,
    'Stopped network must not claim live peers',
  );
  assert(
    [...document.querySelectorAll('.traffic-total dd')].every((node) => node.innerText !== '—'),
    'Stop erased last session totals',
  );
  disconnect.click();
  await waitFor(
    () => document.querySelector('.connection-state h3').textContent === '已连接到网络节点',
  );
  assert(
    !document.querySelector('.traffic-total dd').innerText.includes('MiB'),
    'New session kept old totals',
  );
  assert(document.documentElement.scrollWidth <= innerWidth, 'Dashboard overflowed the viewport');
  return {
    passed: true,
    checked: [
      'hostname',
      'loss-column',
      'unknown-relay-quality',
      'inline-details',
      'stale-preservation',
      'resync',
      'stop-retention',
      'restart-reset',
      'no-overflow',
    ],
  };
})();
