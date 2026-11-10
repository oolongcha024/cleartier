// Versions and failures are controlled at the same platform seam as the application.
(async () => {
  const client = window.__CLEARTIER_DEV__.mock.client;
  async function until(condition) {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('About page did not settle');
      await new Promise((resolve) => setTimeout(resolve, 20));
    }
  }
  async function openAbout() {
    location.hash = '#/settings';
    await until(() => document.querySelector('.settings-page'));
    location.hash = '#/settings/about';
    await until(
      () =>
        document.querySelector('.about-info') &&
        !document.querySelector('.about-info').textContent.includes('加载中'),
    );
    return [...document.querySelectorAll('.about-info dd')].map((node) => node.textContent);
  }
  client.clientVersion = '0.1.0-test';
  client.coreVersion = '2.6.4-test';
  const versions = await openAbout();
  if (versions[0] !== '0.1.0-test' || versions[1] !== '2.6.4-test')
    throw new Error(`Wrong versions: ${versions}`);
  client.failCore = true;
  const coreFailure = await openAbout();
  if (coreFailure[0] !== '0.1.0-test' || coreFailure[1] !== '暂时无法读取')
    throw new Error(`Core error hidden: ${coreFailure}`);
  client.failCore = false;
  client.failClient = true;
  const clientFailure = await openAbout();
  if (clientFailure[0] !== '暂时无法读取' || clientFailure[1] !== '2.6.4-test')
    throw new Error(`Client error hidden: ${clientFailure}`);
  client.failClient = false;
  location.hash = '#/';
  return { passed: true, versions, coreFailure, clientFailure };
})();
