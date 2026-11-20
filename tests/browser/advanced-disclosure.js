// Run after opening Edit network: agent-browser eval --stdin < this file.
// Cover both desktop sizes and repeat with `agent-browser set media dark reduced-motion`.
(async () => {
  const popup = document.querySelector('.network-editor');
  const scroller = document.querySelector('.network-editor-fields');
  const toggle = document.querySelector('.network-advanced-toggle');
  if (!popup || !scroller || !toggle)
    throw new Error('Open Edit network before running this check.');
  const settle = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(
      popup
        .getAnimations({ subtree: true })
        .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity)
        .map((animation) => animation.finished.catch(() => {})),
    );
    await new Promise((resolve) => requestAnimationFrame(resolve));
  };
  // Let the dialog finish its opening focus/transition before simulating a
  // user's scroll to the disclosure row.
  await settle();
  if (toggle.getAttribute('aria-expanded') === 'true') {
    toggle.click();
    await settle();
  }
  scroller.scrollTop = scroller.scrollHeight;
  await settle();
  const position = () => ({
    popupTop: popup.getBoundingClientRect().top,
    popupHeight: popup.getBoundingClientRect().height,
    toggleTop: toggle.getBoundingClientRect().top,
    scrollTop: scroller.scrollTop,
  });
  const before = position();
  const row = toggle.getBoundingClientRect();
  const viewport = scroller.getBoundingClientRect();
  if (row.top < viewport.top - 1 || row.bottom > viewport.bottom + 1)
    throw new Error('Disclosure trigger is not fully visible before the test');
  const results = [];
  for (const expanded of [true, false, true, false]) {
    toggle.click();
    await settle();
    if (toggle.getAttribute('aria-expanded') !== String(expanded))
      throw new Error('Advanced fields did not toggle');
    const after = position();
    results.push({ expanded, ...after });
  }
  const jumps = results.filter(
    (result) =>
      Math.abs(result.toggleTop - before.toggleTop) > 1 ||
      Math.abs(result.popupTop - before.popupTop) > 1 ||
      Math.abs(result.popupHeight - before.popupHeight) > 1 ||
      Math.abs(result.scrollTop - before.scrollTop) > 1,
  );
  if (jumps.length)
    throw new Error(`Disclosure moves viewport: ${JSON.stringify({ before, results })}`);
  const panel = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!panel || getComputedStyle(panel).display !== 'none')
    throw new Error('Collapsed fields remain exposed');
  return {
    passed: true,
    before,
    results,
  };
})();
