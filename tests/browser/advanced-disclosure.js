// Run after opening Edit network: agent-browser eval --stdin < this file.
// Cover both desktop sizes and repeat with `agent-browser set media dark reduced-motion`.
(async () => {
  const popup = document.querySelector('.network-editor');
  const scroller = document.querySelector('.network-editor-fields');
  const toggle = document.querySelector('.network-advanced-toggle');
  if (!popup || !scroller || !toggle) throw new Error('Open Edit network before running this check.');
  const settle = async () => {
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    await Promise.all(popup.getAnimations({ subtree: true })
      .filter(animation => animation.effect?.getComputedTiming().iterations !== Infinity)
      .map(animation => animation.finished.catch(() => {})));
    await new Promise(resolve => requestAnimationFrame(resolve));
  };
  // Let the dialog finish its opening focus/transition before simulating a
  // user's scroll to the disclosure row.
  await settle();
  if (toggle.getAttribute('aria-expanded') === 'true') { toggle.click(); await settle(); }
  scroller.scrollTop = scroller.scrollHeight;
  await settle();
  const position = () => ({ popupTop: popup.getBoundingClientRect().top,
    popupHeight: popup.getBoundingClientRect().height, toggleTop: toggle.getBoundingClientRect().top,
    scrollTop: scroller.scrollTop });
  const before = position();
  const row = toggle.getBoundingClientRect();
  const viewport = scroller.getBoundingClientRect();
  if (row.top < viewport.top - 1 || row.bottom > viewport.bottom + 1) throw new Error('Disclosure trigger is not fully visible before the test');
  const results = [];
  for (const expanded of [true, false, true, false]) {
    toggle.click();
    await settle();
    const after = position();
    results.push({ expanded, ...after });
  }
  const jumps = results.filter(result => Math.abs(result.toggleTop - before.toggleTop) > 1
    || Math.abs(result.popupTop - before.popupTop) > 1 || Math.abs(result.popupHeight - before.popupHeight) > 1
    || Math.abs(result.scrollTop - before.scrollTop) > 1);
  if (jumps.length) throw new Error(`Disclosure moves viewport: ${JSON.stringify({ before, results })}`);
  // Once the user has scrolled into the expanded section, closing it must
  // progressively clamp the shortened scroll range rather than jump in one frame.
  toggle.click(); await settle();
  scroller.scrollTop += toggle.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  await new Promise(resolve => requestAnimationFrame(resolve));
  const firstY = toggle.getBoundingClientRect().top;
  const samples = [firstY];
  const start = performance.now();
  toggle.click();
  do {
    await new Promise(resolve => requestAnimationFrame(resolve));
    if (Math.abs(popup.getBoundingClientRect().top - before.popupTop) > 1) throw new Error('Dialog moves during collapse');
    samples.push(toggle.getBoundingClientRect().top);
  } while (performance.now() - start < 400);
  await settle();
  const travel = Math.abs(samples.at(-1) - firstY);
  const steps = samples.slice(1).map((y, index) => Math.abs(y - samples[index]));
  const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (!reducedMotion && travel > 10 && (steps.filter(step => step > .1).length < 2 || Math.max(...steps) > travel * .8)) {
    throw new Error(`Collapse jumps instead of reflowing: ${JSON.stringify({ travel, steps })}`);
  }
  const panel = document.getElementById(toggle.getAttribute('aria-controls'));
  if (!panel || getComputedStyle(panel).display !== 'none') throw new Error('Collapsed fields remain exposed');
  return { passed: true, before, results, collapse: { reducedMotion, travel, maxFrameStep: Math.max(...steps) } };
})();
