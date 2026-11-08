import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { defaultThemeColor, parseThemeColor, themeColors } from '../src/theme/palettes.ts';

const css = readFileSync(new URL('../src/theme/tokens.css', import.meta.url), 'utf8');

function scheme(id, dark) {
  const selector = `:root[data-theme-color="${id}"]${dark ? '[data-theme="dark"]' : ':not([data-theme="dark"])'} {`;
  assert.ok(css.includes(selector), `Missing scheme: ${id}/${dark}`);
  const block = css.split(selector)[1].split('}')[0];
  return Object.fromEntries(
    [...block.matchAll(/--([\w-]+): (#[\da-f]{6});/g)].map(([, name, value]) => [name, value]),
  );
}

function luminance(hex) {
  const channels = hex
    .slice(1)
    .match(/../g)
    .map((part) => {
      const value = parseInt(part, 16) / 255;
      return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
    });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

function contrast(a, b) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + 0.05) / (values[1] + 0.05);
}

test('new or invalid color preferences use blue; saved choices are retained', () => {
  assert.equal(defaultThemeColor, 'blue');
  for (const value of [null, '', 'unknown', '#00ff00'])
    assert.equal(parseThemeColor(value), 'blue');
  for (const { id } of themeColors) assert.equal(parseThemeColor(id), id);
});

test('every light/dark palette provides readable text pairs and consistent semantic colors', () => {
  for (const dark of [false, true]) {
    const baseline = scheme(defaultThemeColor, dark);
    for (const { id } of themeColors) {
      const tokens = scheme(id, dark);
      for (const role of [
        'primary',
        'primary-container',
        'secondary',
        'secondary-container',
        'tertiary',
        'tertiary-container',
        'error',
        'error-container',
      ]) {
        const ratio = contrast(tokens[`md-sys-color-${role}`], tokens[`md-sys-color-on-${role}`]);
        assert.ok(ratio >= 4.5, `${id}/${dark} ${role} text contrast ${ratio}`);
      }
      for (const surface of [
        'surface',
        'surface-container-lowest',
        'surface-container-low',
        'surface-container',
        'surface-container-high',
        'surface-container-highest',
      ]) {
        for (const foreground of ['on-surface', 'on-surface-variant', 'primary', 'tertiary']) {
          const ratio = contrast(
            tokens[`md-sys-color-${surface}`],
            tokens[`md-sys-color-${foreground}`],
          );
          assert.ok(ratio >= 4.5, `${id}/${dark} ${foreground} on ${surface}: ${ratio}`);
        }
      }
      assert.ok(
        contrast(tokens['color-success-container'], tokens['color-on-success-container']) >= 4.5,
      );
      for (const role of [
        'color-success',
        'color-success-container',
        'color-on-success-container',
        'md-sys-color-error',
      ]) {
        assert.equal(tokens[role], baseline[role], `${id}/${dark} changes semantic color ${role}`);
      }
    }
  }
});
