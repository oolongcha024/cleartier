(async () => {
  const test = window.__updateTest;
  async function until(condition) {
    const deadline = Date.now() + 4000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('Update UI did not settle');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  const button = (text) =>
    [...document.querySelectorAll('button')].find((node) => node.textContent.includes(text));
  async function press(text) {
    await until(() => button(text) && !button(text).disabled);
    button(text).click();
  }
  location.hash = '#/settings/about';
  await until(() => document.querySelector('.update-card'));
  test.failCheck = true;
  await press('检查更新');
  await until(() => document.querySelector('.update-error'));
  if (document.querySelector('.update-card').textContent.includes('已是当前渠道的最新版本'))
    throw new Error('Network failure was shown as current');
  test.failCheck = false;
  await press('检查更新');
  await until(() => document.querySelector('.update-status').textContent.includes('0.2.0-beta.10'));
  const automatic = document.querySelector('[role=switch][aria-label="自动检查更新"]');
  await until(() => !automatic.disabled && automatic.getAttribute('aria-disabled') !== 'true');
  automatic.click();
  await until(() => test.status.preferences.automatic === false);
  test.hold = true;
  await press('下载并更新');
  await until(() => document.querySelector('.update-progress'));
  if (document.querySelector('.update-progress').value !== 40)
    throw new Error('Download progress missing');
  await press('取消下载');
  await until(() => test.status.phase === 'available');
  test.hold = false;
  test.failSignature = true;
  await press('下载并更新');
  await until(() => document.querySelector('.update-error')?.textContent.includes('签名'));
  if (test.installs !== 0) throw new Error('Unverified installer was started');
  test.failSignature = false;
  await press('下载并更新');
  await until(() => document.querySelector('[role=dialog]'));
  if (!document.querySelector('[role=dialog]').textContent.includes('断开所有网络'))
    throw new Error('Network impact was not disclosed');
  test.failCleanup = true;
  await press('断开连接并安装');
  await until(() => document.querySelector('[role=dialog] .update-error'));
  if (test.installs !== 0) throw new Error('Cleanup failure did not prevent installation');
  await press('稍后');
  await until(() => !document.querySelector('[role=dialog]'));
  test.status.distribution = 'portable';
  test.status.error = null;
  test.emit();
  await until(() =>
    [...document.querySelectorAll('button')].some((node) => node.textContent.includes('下载 ZIP')),
  );
  await press('下载 ZIP');
  await until(() => test.opens.includes('openZip'));
  if (test.installs !== 0) throw new Error('Portable app was converted to an installation');
  const errors = window.__telemetryTest?.operations ?? [];
  if (errors.length) throw new Error('Update UI directly controlled networks');
  return { passed: true, downloads: test.downloads, installs: test.installs, opens: test.opens };
})();
