// Native telemetry stays active while the visible read models have separate cadences.
(async () => {
  const control = window.__CLEARTIER_DEV__.mock.networks;
  const visibility = window.__CLEARTIER_DEV__.mock.visibility;
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const waitFor = async (predicate, message) => {
    const deadline = performance.now() + 6500;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(message);
      await new Promise(requestAnimationFrame);
    }
  };
  const settle = () =>
    new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
  const table = () => document.querySelector('.device-table');
  const totals = () => document.querySelector('.traffic-total dd').textContent;
  await waitFor(
    () => document.querySelector('.metric-value')?.textContent.includes('/s'),
    'Traffic did not initialize',
  );
  const peer = table().querySelector('.device-expand');
  peer.click();
  peer.focus();
  await waitFor(() => peer.getAttribute('aria-expanded') === 'true', 'Peer did not expand');
  const before = totals();
  let tableChanges = 0;
  const observer = new MutationObserver((records) => {
    tableChanges += records.length;
  });
  observer.observe(table(), { childList: true, subtree: true, characterData: true });
  await waitFor(() => totals() !== before, 'Traffic stopped publishing');
  check(tableChanges === 0, 'Byte-only samples changed the device table');
  observer.disconnect();
  control.latency = 71.2;
  control.lossRate = 0.035;
  await waitFor(
    () => table().textContent.includes('71.2') && table().textContent.includes('3.5'),
    'Latest quality did not publish',
  );
  check(
    peer === table().querySelector('.device-expand') &&
      peer.getAttribute('aria-expanded') === 'true',
    'Metric refresh replaced or collapsed peer',
  );
  check(document.activeElement === peer, 'Metric refresh lost keyboard focus');

  visibility.emit();
  await settle();
  const unfocused = totals();
  await waitFor(() => totals() !== unfocused, 'An unfocused visible window stopped publishing');

  visibility.visible = false;
  visibility.emit();
  await settle();
  const frozen = totals();
  const reads = control.reads;
  control.latency = 88.8;
  await waitFor(() => control.reads >= reads + 3, 'Background state synchronization stopped');
  await settle();
  check(totals() === frozen, 'Hidden window kept publishing traffic');
  check(!table().textContent.includes('88.8'), 'Hidden window kept publishing device metrics');
  check(control.operations.length === 0, 'Hiding changed a connection');
  const beforeRestore = control.reads;
  visibility.visible = true;
  visibility.emit();
  await waitFor(
    () => totals() !== frozen && table().textContent.includes('88.8'),
    'Visible window failed to catch up',
  );
  check(
    document.querySelector('.metric-value')?.textContent.includes('/s') &&
      !document.querySelector('.chart-empty'),
    'Restore restarted traffic sampling despite continuous background observations',
  );
  check(control.reads > beforeRestore, 'Restore did not request a fresh observation');
  check(
    peer.getAttribute('aria-expanded') === 'true' && document.activeElement === peer,
    'Restore lost disclosure or focus',
  );
  visibility.minimized = true;
  visibility.emit();
  await settle();
  const minimized = totals();
  const minimizedReads = control.reads;
  await waitFor(() => control.reads >= minimizedReads + 2, 'Minimized state sync stopped');
  await settle();
  check(totals() === minimized, 'Minimized window kept publishing');
  visibility.minimized = false;
  visibility.emit();
  await waitFor(() => totals() !== minimized, 'Unminimized view did not recover');

  // Both application and tests exercise the selected visibility adapter.
  const states = [];
  const stop = window.__CLEARTIER_DEV__.platform.watchWindowVisibility((value) =>
    states.push(value),
  );
  visibility.visible = false;
  visibility.emit();
  stop();
  visibility.visible = true;
  visibility.emit();
  check(JSON.stringify(states) === '[true,false]', 'Visibility subscription leaked after cleanup');
  return {
    passed: true,
    checks: [
      'independent-subscriptions',
      'latest-quality',
      'stable-disclosure-and-focus',
      'visible-blur',
      'hidden-publication-paused',
      'background-state-sync',
      'continuous-background-sampling',
      'restore-refresh',
      'minimize-restore',
      'visibility-subscription-cleanup',
    ],
  };
})();
