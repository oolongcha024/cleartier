(async () => {
  const assert = (condition, message) => {
    if (!condition) throw new Error(message);
  };
  const frame = () => new Promise(requestAnimationFrame);
  const deadline = performance.now() + 6000;
  while (document.querySelectorAll('.device-expand').length !== 2) {
    if (performance.now() > deadline) throw new Error('Peers did not appear');
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  await document.fonts.ready;
  await frame();
  await frame();
  const [trigger, other] = document.querySelectorAll('.device-expand');
  const panel = document.getElementById(trigger.getAttribute('aria-controls'));
  const row = trigger.closest('tr').nextElementSibling;
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const height = () => panel.getBoundingClientRect().height;
  // Collapsed table borders can contribute half a pixel to an otherwise empty row.
  const collapsed = () => height() === 0 && row.getBoundingClientRect().height <= 1;
  async function sample(reverse = false) {
    const heights = [];
    for (let index = 0; index < 24; index++) {
      await frame();
      heights.push(height());
      if (reverse && index === 5) trigger.click();
    }
    return heights;
  }
  function smooth(heights, full, label) {
    if (reduced) return;
    const intermediate = heights.filter((value) => value > 1 && value < full - 1);
    assert(intermediate.length >= 2, `${label} jumps instead of animating`);
  }
  assert(collapsed(), 'Closed row leaves a gap');
  assert(row.getAttribute('aria-hidden') === 'true', 'Closed detail row is announced as empty');
  assert(getComputedStyle(panel).display === 'none', 'Closed details remain exposed');
  assert(panel.getAttribute('aria-labelledby') === trigger.id, 'Details lack a device label');
  trigger.focus();
  trigger.click();
  const opening = await sample();
  const full = height();
  assert(full > 0 && trigger.getAttribute('aria-expanded') === 'true', 'Details did not open');
  smooth(opening, full, 'Opening');
  assert(other.getAttribute('aria-expanded') === 'false', 'Another device was expanded');
  const arrow = trigger.querySelector('.icon');
  assert(
    new DOMMatrix(getComputedStyle(arrow).transform).a < -0.99,
    'Expanded arrow did not rotate',
  );
  if (reduced) {
    const durations = getComputedStyle(panel).transitionDuration.split(',').map(parseFloat);
    assert(Math.max(...durations) < 0.001, 'Reduced motion still uses a visible transition');
  }
  trigger.click();
  const closing = await sample();
  smooth(closing, full, 'Closing');
  assert(collapsed(), 'Closed row retains space');
  assert(getComputedStyle(panel).display === 'none', 'Closed details remain accessible');
  assert(
    new DOMMatrix(getComputedStyle(arrow).transform).a > 0.99,
    'Collapsed arrow did not reset',
  );
  trigger.click();
  await sample();
  trigger.click();
  const reversed = await sample(true);
  assert(
    trigger.getAttribute('aria-expanded') === 'true' && Math.abs(height() - full) < 1,
    'Rapid reversal ended in the wrong state',
  );
  if (!reduced) assert(Math.min(...reversed) > 0, 'Reversal snapped through a fully closed row');
  trigger.click();
  await sample();
  assert(document.activeElement === trigger, 'Expansion lost keyboard focus');
  assert(document.documentElement.scrollWidth <= innerWidth, 'Details overflow the viewport');
  return {
    passed: true,
    reduced,
    height: full,
    openingFrames: opening.length,
    closingFrames: closing.length,
  };
})();
