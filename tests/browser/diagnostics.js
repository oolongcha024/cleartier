// Uses the shared development adapter with scene=testing.
(async () => {
  const test = window.__CLEARTIER_DEV__.mock.desktop;
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const waitFor = async (predicate, message) => {
    const deadline = performance.now() + 6000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(message);
      await new Promise(requestAnimationFrame);
    }
  };
  const button = (label) =>
    [...document.querySelectorAll('.diagnostic-card button')].find((node) => {
      const copy = node.cloneNode(true);
      copy.querySelectorAll('[aria-hidden="true"]').forEach((icon) => icon.remove());
      return copy.textContent.trim() === label;
    });
  const summary = () => document.querySelector('.diagnostic-summary');
  const state = (value) => summary()?.dataset.state === value;
  const refresh = async (expected) => {
    // Commit the preceding operation before another synthetic click in this evaluation.
    await new Promise(requestAnimationFrame);
    await waitFor(() => !button('重新检查').disabled, 'Previous operation did not finish');
    button('重新检查').click();
    await waitFor(
      () => state(expected) && !button('重新检查').disabled,
      `Expected ${expected} diagnostics`,
    );
  };
  await waitFor(() => document.querySelector('.connection-card'), 'Dashboard missing');
  const operations = window.__CLEARTIER_DEV__.mock.networks.operations.length;
  document.querySelector('a[href="#/settings"]').click();
  await waitFor(() => state('healthy'), 'Initial report did not render');
  check(!document.querySelector('.diagnostic-checks'), 'Details should start collapsed');
  check(!document.querySelector('.diagnostic-history'), 'History should start collapsed');
  check(document.querySelector('.diagnostic-timestamp'), 'Snapshot timestamp missing');
  check(summary().getAttribute('role') === 'status', 'Result must be announced');
  button('历史记录 · 1 条').click();
  await waitFor(() => document.querySelector('.diagnostic-history'), 'History did not open');
  check(state('healthy'), 'Historical errors changed current health');
  button('检查详情').click();
  await waitFor(() => button('打开日志目录'), 'Details did not open');
  test.failLogs = true;
  button('打开日志目录').click();
  await waitFor(
    () =>
      document
        .querySelector('.diagnostic-card [role="alert"]')
        ?.textContent.includes('无法打开日志目录'),
    'Log error missing',
  );
  check(state('healthy'), 'Opening logs changed diagnostic health');
  test.failLogs = false;
  button('打开日志目录').click();
  await waitFor(() => test.logs === 1 && !button('重新检查').disabled, 'Logs retry failed');

  test.report.networks[0].interfacePresent = null;
  await refresh('incomplete');
  check(
    document.querySelector('.diagnostic-problems').textContent.includes('暂时无法确认虚拟网卡状态'),
    'Unknown TUN misrepresented',
  );
  check(
    !document.querySelector('.diagnostic-check[data-state="error"]'),
    'Unknown TUN shown as failed',
  );
  test.report.networks[0].interfacePresent = false;
  await refresh('issues');
  check(summary().textContent.includes('1 项'), 'Missing interface problem count wrong');
  check(
    document.querySelector('.diagnostic-problems a').getAttribute('href') === '#/networks',
    'Network troubleshooting link missing',
  );
  test.report.networks[0].interfacePresent = true;
  test.report.recentErrors = [];
  await refresh('healthy');
  check(
    ![...document.querySelectorAll('.diagnostic-disclosure-trigger')].some((node) =>
      node.textContent.includes('历史记录'),
    ),
    'Empty history should be omitted',
  );

  test.holdRead = true;
  button('重新检查').click();
  await waitFor(() => state('checking'), 'Check progress missing');
  check(
    button('导出诊断信息').disabled && button('重新检查').disabled,
    'Concurrent operations not disabled',
  );
  test.holdRead = false;
  await waitFor(() => state('healthy') && !button('重新检查').disabled, 'Check completion missing');

  test.failRead = true;
  await refresh('failed');
  check(
    document.querySelector('.diagnostic-card [role="alert"]').textContent.includes('上次成功'),
    'Stale result not identified',
  );
  check(
    document.querySelector('.diagnostic-timestamp'),
    'Failed recheck discarded last successful timestamp',
  );
  test.failRead = false;
  await refresh('healthy');
  test.failExport = true;
  button('导出诊断信息').click();
  await waitFor(
    () =>
      document.querySelector('.diagnostic-card [role="alert"]')?.textContent.includes('未能保存'),
    'Export-specific failure missing',
  );
  check(state('healthy'), 'Export failure changed current health');
  test.failExport = false;
  test.cancelExport = true;
  button('导出诊断信息').click();
  await waitFor(() => !button('导出诊断信息').disabled, 'Cancelled export stayed busy');
  check(test.exports === 0, 'Cancelled export claimed success');

  test.report.networks = [];
  test.report.coreState = 'stopped';
  await refresh('idle');
  check(
    !document.querySelector('.diagnostic-problems'),
    'Intentional idle state shown as an error',
  );
  document.querySelector('a[href="#/"]').click();
  await waitFor(() => document.querySelector('.connection-card'), 'Dashboard missing on revisit');
  test.failRead = true;
  document.querySelector('a[href="#/settings"]').click();
  await waitFor(() => state('failed'), 'Initial read failure was not shown');
  check(!document.querySelector('.diagnostic-timestamp'), 'Initial failure invented a check time');
  test.failRead = false;
  await refresh('idle');
  check(
    window.__CLEARTIER_DEV__.mock.networks.operations.length === operations,
    'Diagnosis changed network state',
  );
  return {
    passed: true,
    checks: [
      'collapsed-details-and-history',
      'history-independent',
      'specific-action-errors',
      'unknown-and-missing-interface',
      'problem-guidance',
      'progress-and-retry',
      'stale-results',
      'cancel-export',
      'idle-without-errors',
      'read-only-diagnostics',
    ],
  };
})();
