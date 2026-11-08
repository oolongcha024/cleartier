// Run on the dashboard browser preview: agent-browser eval --stdin < this file.
(async () => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const frame = () => new Promise(requestAnimationFrame);
  const wait = async (check, timeout = 2000) => {
    const deadline = performance.now() + timeout;
    while (!check()) {
      assert(performance.now() < deadline, 'Snackbar condition timed out');
      await frame();
    }
  };
  const show = async () => {
    document.querySelector('.connection-fact [role="switch"]').click();
    await wait(() => document.querySelector('.snackbar--visible'));
    return document.querySelector('.snackbar > span').textContent;
  };
  const checkExit = async () => {
    const deadline = performance.now() + 2000;
    let frames = 0;
    while (document.querySelector('.snackbar') && performance.now() < deadline) {
      const element = document.querySelector('.snackbar');
      const visible = Number(getComputedStyle(element).opacity) > 0.01;
      assert(!visible || Boolean(element.querySelector(':scope > span').textContent.trim()), 'Visible snackbar frame has no text');
      frames++; await frame();
    }
    assert(!document.querySelector('.snackbar'), 'Closed snackbar left an empty container');
    return frames;
  };
  const region = document.querySelector('.snackbar-region');
  await show();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelector('.snackbar button').click();
  const exitFrames = await checkExit();

  await show();
  await new Promise((resolve) => setTimeout(resolve, 250));
  document.querySelector('.snackbar button').click();
  await frame(); // Put the old notice into its exit phase before replacing it.
  const replacement = await show();
  await new Promise((resolve) => setTimeout(resolve, 350));
  assert(document.querySelector('.snackbar > span')?.textContent === replacement, 'Old close removed the replacement notice');
  await wait(() => !document.querySelector('.snackbar'), 5500);

  const style = document.createElement('style');
  style.textContent = '.snackbar { animation-duration: .01ms !important; transition-duration: .01ms !important; }';
  document.head.append(style);
  try {
    await show();
    document.querySelector('.snackbar button').click();
    await checkExit();
  } finally { style.remove(); }
  assert(region === document.querySelector('.snackbar-region') && region.getAttribute('role') === 'status', 'Live announcement region was removed with the visual container');
  return { passed: true, exitFrames, checked: ['no-empty-frame', 'container-removed', 'replacement-survives-old-exit', 'auto-dismissal', 'reduced-motion', 'persistent-live-region'] };
})();
