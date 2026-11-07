// Run after a fresh page load on the dashboard, before visiting other pages:
// agent-browser eval --stdin < this file. Works with dev and production previews.
(async () => {
  if (location.hash && location.hash !== '#/') throw new Error('Start on a fresh dashboard preview');
  const destinations = [
    ['/settings', '.settings-page'],
    ['/settings/about', '.about-page'],
    ['/networks', '.networks-page'],
    ['/', '.dashboard-grid'],
  ];
  const results = [];
  for (const [path, selector] of [...destinations, ...destinations]) {
    const link = document.querySelector(`a[href="#${path}"]`);
    if (!link) throw new Error(`Missing navigation link: ${path}`);
    const started = performance.now();
    const resourceCount = performance.getEntriesByType('resource').length;
    let loadingCount = 0;
    await new Promise((resolve, reject) => {
      const observer = new MutationObserver((records) => {
        for (const record of records) for (const node of record.addedNodes) {
          if (node instanceof Element && (node.matches('.page-loading') || node.querySelector('.page-loading'))) loadingCount++;
        }
        if (location.hash === `#${path}` && document.querySelector(selector)) {
          observer.disconnect();
          clearTimeout(timeout);
          resolve();
        }
      });
      const timeout = setTimeout(() => {
        observer.disconnect();
        reject(new Error(`Page did not become ready: ${path}`));
      }, 5000);
      observer.observe(document.querySelector('main'), { childList: true, subtree: true });
      link.click();
    });
    const codeRequests = performance.getEntriesByType('resource').slice(resourceCount)
      .map((entry) => new URL(entry.name).pathname)
      .filter((pathname) => /\.(?:tsx?|m?js)$/.test(pathname));
    results.push({ path, loadingCount, codeRequests, contentReadyMs: +(performance.now() - started).toFixed(1) });
  }
  const failures = results.filter((result) => result.loadingCount || result.codeRequests.length);
  if (failures.length) throw new Error(`Page switching introduced loading or requested code: ${JSON.stringify(results)}`);
  return { passed: true, results };
})();
