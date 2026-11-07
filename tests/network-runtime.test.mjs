import assert from 'node:assert/strict';
import test from 'node:test';
import { createDemoRuntime } from '../src/features/networks/runtime.ts';

test('preview runtime acknowledges a transition after its simulated delay', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let finished = false;
  const request = createDemoRuntime()({ action: 'stop', id: 'office' }).then(() => { finished = true; });
  t.mock.timers.tick(899);
  await Promise.resolve();
  assert.equal(finished, false);
  t.mock.timers.tick(1);
  await request;
  assert.equal(finished, true);
});
