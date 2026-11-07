// Run on the app preview with agent-browser eval --stdin < this file.
// Also launch a fresh browser session with --args '--blink-settings=minimumFontSize=12'
// to cover browser minimum-font settings, which can widen invisible text.
(async () => {
  const toggle = document.querySelector('button[aria-controls="sidebar-navigation"]');
  const panel = document.querySelector('#sidebar-navigation');
  if (!toggle || !panel) throw new Error('Open the app preview before running this check.');
  const initiallyExpanded = toggle.getAttribute('aria-expanded') === 'true';
  const settle = async () => {
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    const animations = document.querySelector('.app-shell').getAnimations({ subtree: true })
      .filter((animation) => animation.effect?.getComputedTiming().iterations !== Infinity);
    await Promise.all(animations.map((animation) => animation.finished.catch(() => {})));
  };
  const results = [];

  try {
    for (const expanded of [true, false, true, false]) {
      if ((toggle.getAttribute('aria-expanded') === 'true') !== expanded) toggle.click();
      await settle();
      const width = panel.clientWidth;
      const scrollWidth = panel.scrollWidth;
      if (scrollWidth > width) {
        throw new Error(`Navigation has horizontal overflow (${expanded ? 'expanded' : 'collapsed'}): ${scrollWidth}px > ${width}px`);
      }
      results.push({ expanded, width, scrollWidth });
    }
    return { passed: true, results };
  } finally {
    if ((toggle.getAttribute('aria-expanded') === 'true') !== initiallyExpanded) toggle.click();
    await settle();
  }
})();
