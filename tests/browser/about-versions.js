// Run with agent-browser eval --stdin. Native calls below are explicit UI mocks.
(async () => {
  const savedDesktop = window.isTauri;
  const savedInternals = window.__TAURI_INTERNALS__;
  async function openAbout() {
    location.hash = '#/settings';
    await until(() => document.querySelector('.settings-page'));
    location.hash = '#/settings/about';
    await until(() => document.querySelector('.about-info') && !document.querySelector('.about-info').textContent.includes('加载中'));
    return [...document.querySelectorAll('.about-info dd')].map(node => node.textContent);
  }
  async function until(condition) {
    const deadline = Date.now() + 3000;
    while (!condition()) {
      if (Date.now() > deadline) throw new Error('About page did not settle');
      await new Promise(resolve => setTimeout(resolve, 20));
    }
  }
  function mockNative(failedCommand) {
    window.isTauri = true;
    window.__TAURI_INTERNALS__ = {
      invoke: async (command) => {
        if (command === failedCommand) throw new Error('Test native failure');
        if (command === 'core_version') return '2.6.4-test';
        if (command === 'plugin:app|version') return '0.1.0-test';
        if (command === 'host_environment') return ['Test-PC', 'windows'];
        throw new Error(`Unexpected native command: ${command}`);
      },
    };
  }
  try {
    window.isTauri = false;
    const preview = await openAbout();
    if (preview[1] !== '浏览器预览不运行内核') throw new Error(`Preview claims a native core: ${preview}`);
    mockNative();
    const native = await openAbout();
    if (native[0] !== '0.1.0-test' || native[1] !== '2.6.4-test') throw new Error(`Wrong native versions: ${native}`);
    mockNative('core_version');
    const coreFailure = await openAbout();
    if (coreFailure[0] !== '0.1.0-test' || coreFailure[1] !== '暂时无法读取') throw new Error(`Core error was hidden: ${coreFailure}`);
    mockNative('plugin:app|version');
    const clientFailure = await openAbout();
    if (clientFailure[0] !== '暂时无法读取' || clientFailure[1] !== '2.6.4-test') throw new Error(`Client error was hidden: ${clientFailure}`);
    return { passed: true, preview, nativeMock: native, coreFailure, clientFailure };
  } finally {
    window.isTauri = savedDesktop;
    window.__TAURI_INTERNALS__ = savedInternals;
    location.hash = '#/';
  }
})();
