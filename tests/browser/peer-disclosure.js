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
  async function settle() {
    await frame();
    await frame();
    await Promise.all(panel.getAnimations().map((animation) => animation.finished));
  }
  assert(collapsed(), 'Closed row leaves a gap');
  assert(row.getAttribute('aria-hidden') === 'true', 'Closed detail row is announced as empty');
  assert(getComputedStyle(panel).display === 'none', 'Closed details remain exposed');
  assert(panel.getAttribute('aria-labelledby') === trigger.id, 'Details lack a device label');
  trigger.focus();
  trigger.click();
  await settle();
  const full = height();
  assert(full > 0 && trigger.getAttribute('aria-expanded') === 'true', 'Details did not open');
  assert(other.getAttribute('aria-expanded') === 'false', 'Another device was expanded');
  if (reduced) {
    const durations = getComputedStyle(panel).transitionDuration.split(',').map(parseFloat);
    assert(Math.max(...durations) < 0.001, 'Reduced motion still uses a visible transition');
  }
  trigger.click();
  await frame();
  await frame();
  trigger.click();
  await settle();
  assert(
    trigger.getAttribute('aria-expanded') === 'true' && Math.abs(height() - full) < 1,
    'Rapid reversal ended in the wrong state',
  );
  trigger.click();
  await settle();
  const closeDeadline = performance.now() + 2000;
  while (getComputedStyle(panel).display !== 'none') {
    assert(performance.now() < closeDeadline, 'Closed details remain accessible');
    await frame();
  }
  assert(collapsed(), 'Closed row retains space');
  assert(document.activeElement === trigger, 'Expansion lost keyboard focus');
  assert(document.documentElement.scrollWidth <= innerWidth, 'Details overflow the viewport');
  return { passed: true, reduced, height: full };
})();
