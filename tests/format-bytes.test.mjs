import assert from 'node:assert/strict';
import test from 'node:test';
import { formatBytes } from '../src/lib/format-bytes.ts';

test('unavailable traffic is distinct from a recorded zero', () => {
  assert.deepEqual(formatBytes(undefined), { value: '—', unit: '' });
  assert.deepEqual(formatBytes(0), { value: '0', unit: 'B' });
});

test('byte totals use correctly labelled binary units', () => {
  assert.deepEqual(formatBytes(1023), { value: '1023', unit: 'B' });
  assert.deepEqual(formatBytes(1024), { value: '1.00', unit: 'KiB' });
  assert.deepEqual(formatBytes(134_217_728), { value: '128.00', unit: 'MiB' });
  assert.deepEqual(formatBytes(2_000_000_000), { value: '1.86', unit: 'GiB' });
  assert.deepEqual(formatBytes(1024 ** 4), { value: '1.00', unit: 'TiB' });
});

test('rounding at a unit boundary promotes the display unit', () => {
  assert.deepEqual(formatBytes(1024 ** 2 - 1), { value: '1.00', unit: 'MiB' });
});

test('invalid counters are not displayed as real traffic', () => {
  for (const value of [-1, NaN, Infinity]) assert.deepEqual(formatBytes(value), { value: '—', unit: '' });
});
