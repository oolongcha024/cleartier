// Run with native-telemetry.js + native-desktop.js, on a fresh dashboard.
// This exercises UI/IPC contracts; it never changes OS startup or writes a file.
(async () => {
  const test = window.__desktopTest;
  const waitFor = async (predicate, message) => {
    const deadline = performance.now() + 6000;
    while (!predicate()) {
      if (performance.now() > deadline) throw new Error(message);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  };
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  const text = (node) => {
    const copy = node.cloneNode(true);
    copy.querySelectorAll('[aria-hidden="true"]').forEach((icon) => icon.remove());
    return copy.textContent.trim();
  };
  const button = (label, scope = document) =>
    [...scope.querySelectorAll('button')].find(
      (node) => node.getAttribute('role') !== 'combobox' && text(node) === label,
    );
  const toggle = (label) => document.querySelector(`[role="switch"][aria-label="${label}"]`);
  const disabled = (node) => node?.disabled || node?.getAttribute('aria-disabled') === 'true';
  const dialog = () =>
    document.querySelector('.desktop-dialog[role="dialog"]:not([data-ending-style])');
  const closeDialog = () => !dialog();
  const settings = () => document.querySelector('a[href="#/settings"]').click();
  const dashboard = () => document.querySelector('a[href="#/"]').click();
  await waitFor(() => document.querySelector('.connection-card'), 'dashboard did not initialize');
  const operations = window.__telemetryTest.operations.length;
  settings();
  await waitFor(
    () =>
      toggle('登录系统后启动') &&
      document.querySelector('.diagnostic-summary[data-state="healthy"]'),
    'settings or diagnostics missing',
  );
  check(
    toggle('登录系统后启动').getAttribute('aria-checked') === 'false',
    'login startup must default off',
  );
  check(
    toggle('连接异常后自动恢复').getAttribute('aria-checked') === 'true',
    'recovery must default on',
  );
  toggle('登录系统后启动').click();
  await waitFor(
    () =>
      test.status.preferences.launchAtLogin &&
      toggle('登录系统后启动').getAttribute('aria-checked') === 'true' &&
      !disabled(toggle('登录系统后启动')),
    'startup preference did not save',
  );
  toggle('连接异常后自动恢复').click();
  await waitFor(
    () =>
      !test.status.preferences.autoRecover &&
      toggle('连接异常后自动恢复').getAttribute('aria-checked') === 'false' &&
      !disabled(toggle('连接异常后自动恢复')),
    'recovery preference did not save',
  );
  const select = document.querySelector('[role="combobox"][aria-label="关闭窗口时"]');
  select.click();
  await waitFor(
    () =>
      [...document.querySelectorAll('[role="option"]')].some((node) =>
        node.textContent.includes('退出客户端'),
      ),
    'close options missing',
  );
  [...document.querySelectorAll('[role="option"]')]
    .find((node) => node.textContent.includes('退出客户端'))
    .click();
  await waitFor(
    () =>
      test.status.preferences.closeBehavior === 'exit' &&
      select.textContent.includes('退出客户端') &&
      !select.disabled,
    'close behavior not saved',
  );
  test.failSave = true;
  await waitFor(() => !disabled(toggle('连接异常后自动恢复')), 'controls stayed disabled');
  toggle('连接异常后自动恢复').click();
  await waitFor(
    () => document.querySelector('.settings-notice[role="alert"]'),
    'save error not shown',
  );
  check(
    toggle('连接异常后自动恢复').getAttribute('aria-checked') === 'false',
    'failed save changed displayed preference',
  );
  test.failSave = false;
  toggle('连接异常后自动恢复').click();
  await waitFor(
    () =>
      test.status.preferences.autoRecover &&
      toggle('连接异常后自动恢复').getAttribute('aria-checked') === 'true' &&
      !disabled(toggle('连接异常后自动恢复')),
    'save retry failed',
  );
  check(
    window.__telemetryTest.operations.length === operations,
    'desktop settings restarted a network',
  );
  test.request('close');
  await waitFor(dialog, 'first close dialog missing');
  const heading = dialog().querySelector('.dialog-heading');
  const description = dialog().querySelector('.dialog-description');
  const actions = dialog().querySelector('.desktop-dialog-actions');
  check(
    Math.abs(
      description.getBoundingClientRect().top - heading.getBoundingClientRect().bottom - 16,
    ) < 1,
    'title/body spacing wrong',
  );
  check(
    Math.abs(
      actions.getBoundingClientRect().top - description.getBoundingClientRect().bottom - 24,
    ) < 1,
    'body/action spacing wrong',
  );
  test.failRespond = true;
  button('后台运行', dialog()).click();
  await waitFor(
    () => dialog()?.querySelector('[role="alert"]'),
    'close response failure not retained',
  );
  test.failRespond = false;
  button('后台运行', dialog()).click();
  await waitFor(closeDialog, 'background response did not dismiss dialog');
  check(test.status.preferences.closeExplained, 'first close explanation was not remembered');
  button('退出 ClearTier').click();
  await waitFor(
    () => dialog()?.textContent.includes('退出 ClearTier？'),
    'exit confirmation missing',
  );
  button('取消', dialog()).click();
  await waitFor(closeDialog, 'exit cancellation did not dismiss');
  check(window.__telemetryTest.operations.length === operations, 'cancel exit affected network');
  test.request('close');
  await waitFor(dialog, 'close request missing');
  button('退出客户端', dialog()).click();
  await waitFor(
    () => dialog()?.textContent.includes('退出 ClearTier？'),
    'close-to-exit skipped confirmation',
  );
  button('断开并退出', dialog()).click();
  await waitFor(closeDialog, 'exit acknowledgement missing');
  check(test.responses.at(-1).choice === 'exit', 'explicit exit not sent');
  button('检查详情').click();
  await waitFor(() => button('打开日志目录'), 'diagnostic details missing');
  button('打开日志目录').click();
  await waitFor(() => test.logs === 1, 'logs action missing');
  await waitFor(() => button('导出诊断信息')?.disabled === false, 'diagnostic controls disabled');
  button('导出诊断信息').click();
  await waitFor(
    () =>
      test.exports === 1 &&
      document.querySelector('.snackbar')?.textContent.includes('诊断信息已导出'),
    'export not acknowledged',
  );
  test.failExport = true;
  await waitFor(() => button('导出诊断信息')?.disabled === false, 'export remained busy');
  button('导出诊断信息').click();
  await waitFor(
    () => document.querySelector('.settings-notice[role="alert"]'),
    'failed export not shown',
  );
  check(test.exports === 1, 'failed export claimed completion');
  test.failExport = false;
  test.cancelExport = true;
  button('导出诊断信息').click();
  await waitFor(() => button('导出诊断信息')?.disabled === false, 'cancelled export remained busy');
  check(test.exports === 1, 'cancelled export claimed completion');
  test.cancelExport = false;
  dashboard();
  await waitFor(() => document.querySelector('.connection-card'), 'dashboard missing');
  test.recovery = { phase: 'waiting', attempt: 0, maxAttempts: 3, retryInSeconds: 2 };
  window.dispatchEvent(new Event('focus'));
  await waitFor(
    () => document.querySelector('.connection-state h3')?.textContent === '等待恢复',
    'recovery status missing',
  );
  check(
    document.querySelector('.connection-state-text p').textContent.includes('断线前的参数'),
    'recovery source not explained',
  );
  button('断开连接', document.querySelector('.connection-card')).click();
  await waitFor(
    () =>
      window.__telemetryTest.operations.at(-1) === 'stop' &&
      document.querySelector('.connection-state h3')?.textContent === '网络已断开',
    'waiting recovery not cancellable',
  );
  button('连接网络', document.querySelector('.connection-card')).click();
  await waitFor(
    () =>
      window.__telemetryTest.operations.at(-1) === 'start' &&
      document.querySelector('.connection-state h3')?.textContent !== '正在启动连接',
    'manual start failed',
  );
  test.recovery = { phase: 'starting', attempt: 1, maxAttempts: 3, retryInSeconds: 0 };
  window.dispatchEvent(new Event('focus'));
  await waitFor(
    () => document.querySelector('.connection-state h3')?.textContent === '正在恢复连接',
    'in-flight recovery state missing',
  );
  check(
    !button('断开连接', document.querySelector('.connection-card'))?.disabled,
    'in-flight recovery cannot be cancelled',
  );
  button('断开连接', document.querySelector('.connection-card')).click();
  await waitFor(
    () => document.querySelector('.connection-state h3')?.textContent === '网络已断开',
    'in-flight recovery did not stop',
  );
  button('连接网络', document.querySelector('.connection-card')).click();
  await waitFor(
    () => document.querySelector('.connection-state h3')?.textContent === '已连接到网络节点',
    'manual start after cancellation failed',
  );
  test.recovery = { phase: 'authorization', attempt: 1, maxAttempts: 3, retryInSeconds: 0 };
  window.dispatchEvent(new Event('focus'));
  await waitFor(
    () => document.querySelector('.connection-state-text p')?.textContent.includes('重新授权'),
    'authorization feedback missing',
  );
  check(
    !button('重新连接', document.querySelector('.quick-actions')).disabled,
    'manual retry disabled after authorization failure',
  );
  button('重新连接', document.querySelector('.quick-actions')).click();
  await waitFor(
    () =>
      window.__telemetryTest.operations.at(-1) === 'restart' &&
      !test.recovery &&
      document.querySelector('.connection-state h3')?.textContent === '已连接到网络节点',
    'manual recovery retry not sent',
  );
  document.querySelector('.quick-actions button[aria-label^="编辑"]').click();
  await waitFor(
    () => document.querySelector('.network-editor input[name="alias"]'),
    'editor did not open',
  );
  const alias = document.querySelector('.network-editor input[name="alias"]');
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(
    alias,
    '未保存的工作名称',
  );
  alias.dispatchEvent(new Event('input', { bubbles: true }));
  test.request('close');
  await waitFor(dialog, 'close explanation missing over editor');
  button('后台运行', dialog()).click();
  await waitFor(closeDialog, 'background close stuck over editor');
  check(
    document.querySelector('.network-editor input[name="alias"]').value === '未保存的工作名称',
    'background close lost editor draft',
  );
  button('取消', document.querySelector('.network-editor')).click();
  await waitFor(
    () => button('放弃修改', document.querySelector('.network-editor')),
    'discard confirmation missing',
  );
  button('放弃修改', document.querySelector('.network-editor')).click();
  await waitFor(
    () => !document.querySelector('.network-editor:not([data-ending-style])'),
    'editor did not dismiss',
  );
  settings();
  await waitFor(() => toggle('登录系统后启动'), 'settings missing on revisit');
  check(
    toggle('登录系统后启动').getAttribute('aria-checked') === 'true',
    'settings lost on navigation',
  );
  test.status.preferenceError = 'invalid';
  test.emit();
  await waitFor(
    () => disabled(toggle('登录系统后启动')),
    'unreadable preferences remained writable',
  );
  test.status.preferenceError = null;
  test.status.quitting = true;
  test.emit();
  await waitFor(
    () =>
      document.querySelector('.desktop-exit-status') && document.querySelector('.app-shell').inert,
    'shutdown did not block UI',
  );
  test.status.quitting = false;
  test.emit();
  await waitFor(() => !document.querySelector('.desktop-exit-status'), 'shutdown overlay stuck');
  return {
    passed: true,
    checks: [
      'settings-save-failure-retry',
      'close-dialog-spacing',
      'close-error-retry',
      'background-explanation',
      'exit-confirmation-cancel',
      'diagnostic-export-failure-cancel',
      'recovery-cancel-authorization-retry',
      'background-draft-preserved',
      'preferences-read-error',
      'shutdown-inert',
    ],
  };
})();
