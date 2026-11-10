// Uses the shared development adapter with scene=testing.
(async () => {
  const check = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const wait = async (predicate, message) => {
    const end = performance.now() + 6000;
    while (!predicate()) {
      if (performance.now() > end) throw new Error(message);
      await new Promise((resolve) => requestAnimationFrame(resolve));
    }
  };
  const button = (text, root = document) =>
    [...root.querySelectorAll('button')].find(
      (node) =>
        [...node.childNodes]
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent)
          .join('')
          .trim() === text,
    );
  const fill = (name, value) => {
    const field = document.querySelector(`input[name="${name}"]`);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(field, value);
    field.dispatchEvent(new Event('input', { bubbles: true }));
  };
  document.querySelector('a[href="#/networks"]').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(() => button('导入 TOML'), 'Import action missing');
  const original = await window.__CLEARTIER_DEV__.platform.networks.storage.load();
  window.__CLEARTIER_DEV__.mock.configuration.cancelPick = true;
  button('导入 TOML').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(() => !button('导入 TOML').disabled, 'Cancelled chooser stuck');
  check(!document.querySelector('.configuration-transfer'), 'Cancel created a preview');
  window.__CLEARTIER_DEV__.mock.configuration.cancelPick = false;
  window.__CLEARTIER_DEV__.mock.configuration.invalidPick = true;
  button('导入 TOML').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(
    () => document.querySelector('.snackbar')?.textContent.includes('TOML 内容无效'),
    'Invalid TOML feedback missing',
  );
  check(
    document.querySelectorAll('.network-config-row').length === 2,
    'Failed import changed records',
  );
  window.__CLEARTIER_DEV__.mock.configuration.invalidPick = false;
  button('导入 TOML').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(() => document.querySelector('input[name="importAlias"]'), 'Preview missing');
  await wait(() => document.querySelector('.compatibility-issues'), 'Compatibility report missing');
  check(
    !document.querySelector('.configuration-transfer').textContent.includes('test-only'),
    'Preview exposed a credential',
  );
  check(button('仍然导入').disabled, 'Duplicate TUN name was accepted');
  fill('importAlias', '迁移配置');
  fill('importTunName', 'ct-migrated');
  await wait(() => !button('仍然导入').disabled, 'Resolved TUN conflict did not revalidate');
  window.__CLEARTIER_DEV__.mock.networks.failSave = true;
  button('仍然导入').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(
    () =>
      document
        .querySelector('.configuration-transfer [role="alert"]')
        ?.textContent.includes('保存失败'),
    'Failed save feedback missing',
  );
  check(
    document.querySelector('input[name="importAlias"]').value === '迁移配置',
    'Failed save discarded input',
  );
  window.__CLEARTIER_DEV__.mock.networks.failSave = false;
  button('仍然导入').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(
    () => document.querySelectorAll('.network-config-row').length === 3,
    'Import not persisted',
  );
  await wait(() => !document.querySelector('.configuration-transfer'), 'Import dialog not closed');
  const imported = (await window.__CLEARTIER_DEV__.platform.networks.storage.load()).networks[2];
  check(imported.client.autoConnect === false, 'Import enabled automatic connection');
  check(
    imported.config.hostname === 'migrated-node' && imported.config.ipv4Address === '10.77.0.8',
    'Migration changed machine settings',
  );
  check(imported.id !== original.networks[0].id, 'Import reused another record identity');
  document.querySelectorAll('.network-config-row')[2].querySelector('button').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(
    () => document.querySelector('.network-editor input[name="hostname"]'),
    'Imported editor missing',
  );
  await wait(
    () => document.querySelector('.network-editor .compatibility-issues'),
    'Reopened editor lost blocked-field explanation',
  );
  fill('hostname', 'edited-node');
  button('保存修改').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(() => !document.querySelector('.network-editor'), 'Imported edit did not save');
  const edited = (await window.__CLEARTIER_DEV__.platform.networks.storage.load()).networks[2];
  check(edited.config.hostname === 'edited-node', 'Visible field edit missing');
  check(
    edited.config.officialToml === imported.config.officialToml,
    'Editing destroyed preservation base',
  );
  check(
    window.__CLEARTIER_DEV__.mock.networks.operations.length === 0,
    'Import/edit unexpectedly operated core',
  );
  document
    .querySelectorAll('.network-config-row')[2]
    .querySelector('[aria-label^="导出 "]')
    .click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(() => button('选择保存位置'), 'Export confirmation missing');
  window.__CLEARTIER_DEV__.mock.configuration.failExport = true;
  button('选择保存位置').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(
    () => document.querySelector('.dialog-popup [role="alert"]'),
    'Failed export feedback missing',
  );
  window.__CLEARTIER_DEV__.mock.configuration.failExport = false;
  window.__CLEARTIER_DEV__.mock.configuration.cancelExport = true;
  button('选择保存位置').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(() => !button('选择保存位置').disabled, 'Cancelled export stuck');
  check(
    window.__CLEARTIER_DEV__.mock.configuration.exports.length === 0,
    'Cancelled export claimed a saved file',
  );
  window.__CLEARTIER_DEV__.mock.configuration.cancelExport = false;
  button('选择保存位置').click();
  await new Promise((resolve) => requestAnimationFrame(resolve));
  await wait(() => !document.querySelector('.dialog-popup'), 'Export did not complete');
  check(
    window.__CLEARTIER_DEV__.mock.configuration.exports[0].config.officialToml ===
      imported.config.officialToml,
    'Export lost unknown fields',
  );
  check(
    window.__CLEARTIER_DEV__.mock.configuration.exports[0].config.hostname === 'edited-node',
    'Export used obsolete editor parameters',
  );
  const saved = await window.__CLEARTIER_DEV__.platform.networks.storage.load();
  check(
    saved.networks
      .slice(0, 2)
      .every(
        (record, index) =>
          JSON.stringify(record.config) === JSON.stringify(original.networks[index].config) &&
          record.client.alias === original.networks[index].client.alias &&
          record.client.autoConnect === original.networks[index].client.autoConnect,
      ),
    'Migration changed existing networks',
  );
  return {
    passed: true,
    checked: [
      'chooser-cancel',
      'invalid-file',
      'masked-preview',
      'tun-conflict',
      'failed-save-retry',
      'new-manual-profile',
      'unknown-fields-retained',
      'edit-report',
      'export-failure-cancel-retry',
      'other-networks-unchanged',
    ],
  };
})();
