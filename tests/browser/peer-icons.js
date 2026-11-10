// Uses the shared development adapter with scene=testing.
// Saves a phone override within this isolated mock session.
(async () => {
  const assert = (value, message) => {
    if (!value) throw new Error(message);
  };
  const wait = async (check) => {
    const deadline = performance.now() + 6000;
    while (!check()) {
      if (performance.now() > deadline) throw new Error('Peer icon condition timed out');
      await new Promise((resolve) => setTimeout(resolve, 80));
    }
  };
  const icons = () =>
    [...document.querySelectorAll('.device-icon > .icon')].map((node) => node.textContent);
  const choice = async (label) => {
    document.querySelector('.device-icon-trigger').click();
    await wait(() => document.querySelector('.peer-icon-menu [role="menuitemradio"]'));
    const option = [...document.querySelectorAll('.peer-icon-menu [role="menuitemradio"]')].find(
      (node) => node.querySelector('.peer-icon-menu-label')?.textContent === label,
    );
    assert(option, `Missing choice ${label}`);
    option.click();
    await wait(() => !document.querySelector('.peer-icon-menu:not([data-ending-style])'));
  };
  await wait(() => document.querySelectorAll('.device-icon').length === 2);
  assert(icons()[0] === 'dns' && icons()[1] === 'devices', 'Automatic role mapping is wrong');
  assert(
    document.querySelector('.device-expand').getAttribute('aria-expanded') === 'false',
    'Details should start collapsed',
  );
  await choice('手机');
  await wait(() => icons()[0] === 'smartphone');
  let saved = await window.__CLEARTIER_DEV__.platform.networks.storage.load();
  const identity = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
  assert(
    saved.networks[0].client.peerIcons[identity] === 'phone',
    'Icon was not saved in client metadata',
  );
  assert(!('peerIcons' in saved.networks[0].config), 'Local choice leaked into core config');
  window.__CLEARTIER_DEV__.mock.networks.failSave = true;
  await choice('路由器');
  await wait(() => document.querySelector('[role="alert"]'));
  assert(icons()[0] === 'smartphone', 'Failed save changed the displayed icon');
  assert(
    document.querySelector('.device-expand').getAttribute('aria-expanded') === 'false',
    'Picking an icon expanded the row',
  );
  window.__CLEARTIER_DEV__.mock.networks.failSave = false;
  document.querySelector('.device-expand').click();
  await wait(
    () => document.querySelector('.device-expand').getAttribute('aria-expanded') === 'true',
  );
  await choice('自动');
  await wait(() => icons()[0] === 'dns');
  assert(
    document.querySelector('.device-expand').getAttribute('aria-expanded') === 'true',
    'Picking an icon changed expanded details',
  );
  saved = await window.__CLEARTIER_DEV__.platform.networks.storage.load();
  assert(
    !Object.hasOwn(saved.networks[0].client.peerIcons, identity),
    'Auto did not remove the override',
  );
  await choice('手机');
  await wait(() => icons()[0] === 'smartphone');
  assert(
    window.__CLEARTIER_DEV__.mock.networks.operations.length === 0,
    'Changing icons triggered a core operation',
  );
  assert(document.documentElement.scrollWidth <= innerWidth, 'Icon menu caused page overflow');
  return {
    passed: true,
    checked: [
      'role-defaults',
      'direct-icon-picker',
      'independent-expansion',
      'manual-choice',
      'client-only-save',
      'failed-save',
      'restore-auto',
      'no-reconnect',
      'no-overflow',
    ],
    savedIcon: 'smartphone',
  };
})();
