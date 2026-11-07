// Run on a fresh dashboard preview: agent-browser eval --stdin < this file.
// Edits demo data in memory; reload afterwards to restore the demo fixture.
(async () => {
  const waitFor = async (predicate, message) => {
    const end = performance.now() + 5000;
    while (!predicate()) {
      if (performance.now() > end) throw new Error(message);
      await new Promise(resolve => requestAnimationFrame(resolve));
    }
  };
  const check = (condition, message) => { if (!condition) throw new Error(message); };
  const field = name => document.querySelector(`.network-editor input[name="${name}"]`);
  const fill = (name, value) => {
    const input = field(name);
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const button = text => [...document.querySelectorAll('.network-editor button')].find(item => item.textContent === text);
  const close = async () => {
    button('取消').click();
    await waitFor(() => !document.querySelector('.network-editor'), 'Editor did not close');
  };
  const open = async (target) => {
    target().click();
    await waitFor(() => field('alias'), 'Editor did not open');
  };
  const save = async () => {
    await waitFor(() => !button('保存修改').disabled, 'Draft change did not reach the form');
    button('保存修改').click();
  };
  const dashboardEdit = () => document.querySelector('.quick-action[aria-label^="编辑 "]');
  check(dashboardEdit(), 'Start on a fresh dashboard');
  const originalAlias = document.querySelector('.connection-card h2').textContent;
  const originalName = document.querySelector('.network-identity > span').textContent;

  await open(dashboardEdit);
  fill('alias', '未保存的草稿');
  await close();
  await open(dashboardEdit);
  check(field('alias').value === originalAlias, 'Reopening leaked an unsaved draft');
  fill('alias', '测试办公室');
  await save();
  await waitFor(() => !document.querySelector('.network-editor'), 'Local edit unexpectedly requested reconnect');
  check(document.querySelector('.connection-card h2').textContent === '测试办公室', 'Local edit was not saved');

  await open(dashboardEdit);
  fill('name', 'next-office');
  await save();
  await waitFor(() => button('稍后应用'), 'Online core edit did not request confirmation');
  check(document.querySelector('.network-identity > span').textContent === originalName, 'Unconfirmed edit changed active parameters');
  button('稍后应用').click();
  await waitFor(() => !document.querySelector('.network-editor'), 'Save for later did not close the editor');
  check(document.querySelector('.network-heading-status').textContent.includes('待应用'), 'Pending state is missing');
  check(document.querySelector('.network-identity > span').textContent === originalName, 'Save for later changed active parameters');

  await open(dashboardEdit);
  check(field('name').value === 'next-office', 'Saved draft did not survive reopening');
  await save();
  await waitFor(() => button('立即应用'), 'Pending config did not request confirmation');
  button('立即应用').click();
  await waitFor(() => document.querySelector('.network-identity > span')?.textContent === 'next-office', 'Apply did not update active parameters');
  check(!document.querySelector('.network-heading-status').textContent.includes('待应用'), 'Apply did not clear pending state');
  await waitFor(() => !document.querySelector('.network-editor'), 'Applied editor did not close');

  await open(dashboardEdit);
  fill('name', '');
  await save();
  await waitFor(() => field('name')?.getAttribute('aria-invalid') === 'true', 'Invalid draft was accepted');
  await waitFor(() => document.activeElement === field('name'), 'Invalid field did not receive focus');
  fill('name', 'next-office');
  fill('mtu', '399');
  await save();
  await waitFor(() => document.querySelector('.network-advanced-toggle')?.getAttribute('aria-expanded') === 'true', 'Hidden validation error did not expand advanced options');
  await waitFor(() => document.activeElement === field('mtu'), 'Invalid advanced field did not receive focus');
  await close();

  document.querySelector('a.nav-item[href="#/networks"]').click();
  await waitFor(() => document.querySelectorAll('.network-config-row').length === 3, 'Network list did not load');
  const gamingEdit = () => document.querySelectorAll('.network-config-row')[1].querySelector('button');
  await open(gamingEdit);
  check(field('name').value === 'weekend-party', 'Editing another network used the wrong target');
  const gamingAlias = field('alias').value;
  fill('alias', '另一个未保存草稿');
  await close();
  await open(gamingEdit);
  check(field('alias').value === gamingAlias, 'Network list editor leaked a discarded draft');
  await close();
  check(document.querySelectorAll('.network-config-row')[0].textContent.includes('测试办公室'), 'Dashboard edits did not reach network configuration');
  return { passed: true, scenarios: ['fresh sessions in both entry points', 'local save', 'confirmation', 'save for later', 'apply', 'basic and advanced validation focus', 'target isolation'] };
})();
