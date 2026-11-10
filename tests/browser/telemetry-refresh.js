// Native telemetry stays active while the visible read models have separate cadences.
(async () => {
  const control = window.__telemetryTest;
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

  control.emitWindow('tauri://blur');
  await settle();
  const unfocused = totals();
  await waitFor(() => totals() !== unfocused, 'An unfocused visible window stopped publishing');

  control.visible = false;
  control.emitWindow('tauri://blur');
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
  control.visible = true;
  control.emitWindow('tauri://focus');
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
  control.minimized = true;
  control.emitWindow('tauri://resize', { width: 0, height: 0 });
  await settle();
  const minimized = totals();
  const minimizedReads = control.reads;
  await waitFor(() => control.reads >= minimizedReads + 2, 'Minimized state sync stopped');
  await settle();
  check(totals() === minimized, 'Minimized window kept publishing');
  control.minimized = false;
  control.emitWindow('tauri://resize', { width: 1200, height: 800 });
  await waitFor(() => totals() !== minimized, 'Unminimized view did not recover');

  // Browser document visibility follows the same publication seam, without IPC.
  const visibility = await import('/src/platform/window-visibility.ts');
  const previousNative = window.isTauri;
  window.isTauri = false;
  const states = [];
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'hidden' });
  const stop = visibility.watchWindowVisibility((value) => states.push(value));
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  document.dispatchEvent(new Event('visibilitychange'));
  stop();
  delete document.visibilityState;
  window.isTauri = previousNative;
  check(
    JSON.stringify(states) === '[false,true]',
    'Browser preview visibility does not follow document state',
  );
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
      'browser-visibility',
    ],
  };
})();
