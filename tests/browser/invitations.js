// Uses the shared development adapter with scene=testing.
(async () => {
  window.__CLEARTIER_DEV__.mock.networks.failNewConnections = true;
  const check = (value, message) => {
    if (!value) throw new Error(message);
  };
  const frame = () => new Promise((resolve) => requestAnimationFrame(resolve));
  const wait = async (predicate, message) => {
    const end = performance.now() + 6000;
    while (!predicate()) {
      if (performance.now() > end) throw new Error(message);
      await frame();
    }
  };
  const button = (text) =>
    [...document.querySelectorAll('.network-editor button')].find(
      (node) =>
        [...node.childNodes]
          .filter((child) => child.nodeType === Node.TEXT_NODE)
          .map((child) => child.textContent)
          .join('')
          .trim() === text,
    );
  const field = (name) => document.querySelector(`.network-editor [name="${name}"]`);
  const fill = (name, value) => {
    const input = field(name);
    const type = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement : HTMLInputElement;
    Object.getOwnPropertyDescriptor(type.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const encode = (details) =>
    'cleartier:v1:' +
    btoa(String.fromCharCode(...new TextEncoder().encode(JSON.stringify(details))))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
  const decode = (text) =>
    JSON.parse(
      new TextDecoder().decode(
        Uint8Array.from(atob(text.split(':')[2].replace(/-/g, '+').replace(/_/g, '/')), (char) =>
          char.charCodeAt(0),
        ),
      ),
    );
  const inviteButton = () =>
    [...document.querySelectorAll('.quick-action')].find((node) =>
      node.textContent.includes('邀请朋友'),
    );
  const openJoin = async () => {
    document.querySelector('.network-toolbar > .button').click();
    await wait(() => field('invitation'), 'Invitation field missing');
  };
  await wait(() => inviteButton(), 'Start on a fresh dashboard');
  inviteButton().click();
  await wait(
    () => window.__CLEARTIER_DEV__.mock.invitations.writes.length === 1,
    'Single click did not copy',
  );
  check(!document.querySelector('.dialog-popup'), 'Normal invitation opened a dialog');
  const original = decode(window.__CLEARTIER_DEV__.mock.invitations.writes[0]);
  check(
    Object.keys(original).sort().join(',') === 'displayName,name,secret,servers',
    'Invitation carried local settings',
  );
  const existing = await window.__CLEARTIER_DEV__.platform.networks.storage.load();
  check(original.name === existing.networks[0].config.name, 'Wrong invitation target');

  await openJoin();
  await wait(
    () => document.activeElement === field('invitation'),
    'Join did not focus paste field',
  );
  const tun = field('tunName').value;
  fill('invitation', '无效邀请');
  await frame();
  check(field('invitation').getAttribute('aria-invalid') === 'true', 'Bad invite was accepted');
  check(field('name').value === '', 'Bad invite modified fields');
  check(!button('添加网络').disabled, 'Invitation error blocked manual submission');
  button('添加网络').click();
  await wait(
    () => field('name').getAttribute('aria-invalid') === 'true',
    'Actual form validation was skipped',
  );
  await wait(
    () => document.activeElement === field('name'),
    'Failed invitation stole form-validation focus',
  );
  button('取消').click();
  await wait(() => button('继续编辑'), 'Unsaved invitation did not request discard confirmation');
  button('继续编辑').focus();
  button('继续编辑').click();
  await wait(
    () => field('invitation')?.value === '无效邀请',
    'Discard confirmation lost pasted input',
  );
  await wait(
    () => document.activeElement === field('invitation'),
    'Returning to form lost keyboard focus',
  );
  fill('invitation', '');
  await frame();
  check(
    !button('添加网络').disabled && field('name').value === '',
    'Clearing invite did not restore manual entry',
  );
  const newcomer = {
    name: 'new-friends',
    secret: ' exact new key ',
    servers: ['udp://friends.example.com:11010'],
    displayName: '好友网络',
  };
  const code = encode(newcomer);
  const invitationHeight = document
    .querySelector('.network-invitation-field')
    .getBoundingClientRect().height;
  const iconTop = document.querySelector('.network-icon-field').getBoundingClientRect().top;
  const scrollTop = document.querySelector('.network-editor-fields').scrollTop;
  fill('invitation', '一起联机：\n' + code);
  await wait(
    () => document.querySelector('.invitation-applied') && !field('invitation'),
    'Applied invitation did not collapse',
  );
  await wait(() => document.activeElement === field('alias'), 'Autofill did not focus local name');
  check(
    field('name').value === newcomer.name && field('secret').value === newcomer.secret,
    'Autofill changed identity/secret',
  );
  check(field('servers').value === newcomer.servers[0], 'Autofill missed servers');
  check(
    field('hostname').value === 'actual-test-node' && field('tunName').value === tun,
    'Autofill copied sender machine settings',
  );
  check(
    Math.abs(
      document.querySelector('.network-invitation-field').getBoundingClientRect().height -
        invitationHeight,
    ) < 1,
    'Applied state changed invitation height',
  );
  check(
    Math.abs(document.querySelector('.network-icon-field').getBoundingClientRect().top - iconTop) <
      1,
    'Autofill moved form fields',
  );
  check(
    Math.abs(document.querySelector('.network-editor-fields').scrollTop - scrollTop) < 1,
    'Autofill jumped scroll position',
  );
  fill('alias', '我的备注');
  fill('name', 'manual-draft');
  fill('secret', 'manual-key');
  await frame();
  await frame();
  check(
    field('name').value === 'manual-draft' && field('secret').value === 'manual-key',
    'Old invitation overwrote manual edits',
  );
  button('更换邀请').focus();
  button('更换邀请').click();
  await wait(
    () => field('invitation') && document.activeElement === field('invitation'),
    'Replace did not focus input',
  );
  await frame();
  await frame();
  check(
    document.activeElement === field('invitation'),
    'Dialog focus restoration overrode replacement input',
  );
  check(
    field('invitation').value === '' && field('name').value === 'manual-draft',
    'Replace cleared the form or restored stale invitation text',
  );
  fill('invitation', 'cleartier:v99:abc');
  await frame();
  check(
    field('name').value === 'manual-draft' && field('secret').value === 'manual-key',
    'Invalid replacement erased manual edits',
  );
  check(!button('添加网络').disabled, 'Failed replacement blocked valid manual form');
  fill('invitation', code);
  await wait(
    () => document.querySelector('.invitation-applied') && !field('invitation'),
    'Replacement did not apply once',
  );
  check(field('alias').value === '我的备注', 'Replacement erased manual alias');
  window.__CLEARTIER_DEV__.mock.networks.failSave = true;
  button('添加网络').click();
  await wait(
    () => document.querySelector('.network-editor-actions [role="alert"]'),
    'Save failure missing',
  );
  check(
    document.querySelector('.invitation-applied') &&
      !field('invitation') &&
      field('secret').value === newcomer.secret,
    'Failed save erased applied state or draft',
  );
  window.__CLEARTIER_DEV__.mock.networks.failSave = false;
  button('添加网络').click();
  await wait(() => !document.querySelector('.network-editor'), 'Retry did not add network');
  const saved = await window.__CLEARTIER_DEV__.platform.networks.storage.load();
  const added = saved.networks.find((record) => record.config.name === newcomer.name);
  check(added && added.id !== existing.networks[0].id, 'New local identity missing');
  check(
    !added.client.autoConnect && added.config.ipv4Mode === 'auto' && added.config.hostname === null,
    'Receiver defaults wrong',
  );
  check(
    window.__CLEARTIER_DEV__.mock.networks.operations.length === 0,
    'Pasting/saving auto-connected a network',
  );

  // The new network is selected and stopped: sharing must use saved parameters.
  const writes = window.__CLEARTIER_DEV__.mock.invitations.writes.length;
  inviteButton().click();
  await wait(
    () => window.__CLEARTIER_DEV__.mock.invitations.writes.length > writes,
    'Offline share failed',
  );
  check(
    decode(window.__CLEARTIER_DEV__.mock.invitations.writes.at(-1)).secret === newcomer.secret,
    'Offline share ignored saved parameters',
  );
  document.querySelector('.connection-state > button').click();
  await wait(
    () => document.querySelector('.connection-error')?.textContent.includes('虚拟网卡'),
    'Real runtime error path not reached',
  );
  check(
    window.__CLEARTIER_DEV__.mock.invitations.connections[0].config.secret === newcomer.secret,
    'Connection used wrong invitation credentials',
  );
  check(
    (await window.__CLEARTIER_DEV__.platform.networks.storage.load()).networks.some(
      (record) => record.id === added.id,
    ),
    'Failed connection deleted saved invite',
  );

  // Repeated invites use the existing duplicate flow without replacing a profile.
  await openJoin();
  fill('invitation', encode(original));
  await frame();
  button('添加网络').click();
  await wait(() => button('打开已有网络'), 'Duplicate invite did not offer existing profile');
  button('返回编辑').focus();
  button('返回编辑').click();
  await wait(
    () => document.querySelector('.invitation-applied'),
    'Back did not restore applied state',
  );
  check(
    !field('invitation') && field('name').value === original.name,
    'Duplicate confirmation restored stale raw text',
  );
  await wait(
    () => document.activeElement === field('alias'),
    'Duplicate return lost focus after raw text was collapsed',
  );
  button('添加网络').click();
  await wait(() => button('打开已有网络'), 'Duplicate flow missing on retry');
  button('打开已有网络').click();
  await wait(
    () =>
      !document.querySelector('.network-editor') &&
      document.querySelector('.connection-card h2')?.textContent ===
        existing.networks[0].client.alias,
    'Existing profile did not open',
  );
  check(
    (await window.__CLEARTIER_DEV__.platform.networks.storage.load()).networks.length === 3,
    'Duplicate invite created a record',
  );

  // Saved-but-unapplied identity edits must not leak into running invitations.
  document.querySelector('.quick-action[aria-label^="编辑 "]').click();
  await wait(() => field('name'), 'Editor missing');
  fill('name', 'unapplied-office');
  await frame();
  button('保存修改').click();
  await wait(() => button('稍后应用'), 'Pending-config confirmation missing');
  button('稍后应用').click();
  await wait(() => !document.querySelector('.network-editor'), 'Save later did not close');
  const beforePending = window.__CLEARTIER_DEV__.mock.invitations.writes.length;
  inviteButton().click();
  await wait(
    () => window.__CLEARTIER_DEV__.mock.invitations.writes.length > beforePending,
    'Pending share failed',
  );
  check(
    decode(window.__CLEARTIER_DEV__.mock.invitations.writes.at(-1)).name === original.name,
    'Shared unapplied identity',
  );
  await wait(
    () => document.querySelector('.snackbar')?.textContent.includes('待应用修改需重连'),
    'Pending reminder missing',
  );

  window.__CLEARTIER_DEV__.mock.invitations.failCopy = true;
  inviteButton().click();
  await wait(
    () => document.querySelector('.invitation-manual-copy'),
    'Copy failure offered no manual fallback',
  );
  check(
    decode(document.querySelector('.invitation-manual-copy').value).name === original.name,
    'Manual fallback used wrong parameters',
  );
  document.querySelector('.dialog-popup button[aria-label="关闭"]').click();
  await wait(() => !document.querySelector('.dialog-popup'), 'Fallback did not close');
  window.__CLEARTIER_DEV__.mock.invitations.failCopy = false;
  window.__CLEARTIER_DEV__.mock.networks.fail = true;
  await wait(
    () => document.querySelector('.connection-state h3')?.textContent === '状态未知',
    'Stale state not shown',
  );
  const beforeUnknown = window.__CLEARTIER_DEV__.mock.invitations.writes.length;
  inviteButton().click();
  await frame();
  await wait(
    () => document.querySelector('.snackbar')?.textContent.includes('当前连接参数尚未确定'),
    'Unknown source not explained',
  );
  check(
    window.__CLEARTIER_DEV__.mock.invitations.writes.length === beforeUnknown,
    'Unknown state silently shared saved data',
  );
  window.__CLEARTIER_DEV__.mock.networks.fail = false;
  await openJoin();
  fill('invitation', '这不是一份邀请');
  await frame();
  fill('name', 'manual-after-failed-paste');
  fill('secret', 'manual-test-only');
  fill('servers', 'tcp://manual.example.com:11010');
  await frame();
  button('添加网络').click();
  await wait(
    () => !document.querySelector('.network-editor'),
    'Failed invitation prevented manual add',
  );
  const manual = (await window.__CLEARTIER_DEV__.platform.networks.storage.load()).networks.find(
    (record) => record.config.name === 'manual-after-failed-paste',
  );
  check(
    manual?.config.secret === 'manual-test-only',
    'Manual fields were not saved after invitation failure',
  );
  return {
    passed: true,
    checked: [
      'one-click-copy',
      'minimal-fields',
      'one-time-fill',
      'stable-layout-and-focus',
      'replace-preserves-edits',
      'failed-paste-allows-manual-add',
      'receiver-settings',
      'invalid-input',
      'save-retry',
      'manual-connection',
      'offline-source',
      'duplicate-preserves-applied-state',
      'open-existing',
      'pending-running-source',
      'manual-copy-fallback',
      'unknown-state',
    ],
  };
})();
