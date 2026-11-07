import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTunName } from '../src/features/networks/defaults.ts';
import { activeVirtualIp } from '../src/features/networks/model.ts';
import { demoNetworks } from '../src/features/networks/demo.ts';

test('generated TUN names are stable, short, unique between demo networks and case-insensitive collision aware', () => {
  const names = demoNetworks.map((network) => defaultTunName(network.id));
  assert.equal(new Set(names).size, demoNetworks.length);
  for (const network of demoNetworks) {
    const name = defaultTunName(network.id);
    assert.match(name, /^[a-z\d-]{1,15}$/);
    assert.equal(defaultTunName(network.id), name);
    assert.notEqual(defaultTunName(network.id, [name.toUpperCase()]), name);
    const next = defaultTunName(network.id, [name, `${name}-1`]);
    assert.notEqual(next, `${name}-1`);
    assert.ok(next.length <= 15);
  }
});

test('displayed IP follows active parameters rather than unapplied edits; auto restores demo lease', () => {
  const network = structuredClone(demoNetworks[0]);
  network.savedConfig = { ...network.savedConfig, ipv4Mode: 'manual', ipv4Address: '10.88.0.9' };
  assert.equal(activeVirtualIp(network), network.virtualIp);
  network.runningConfig = network.savedConfig;
  assert.equal(activeVirtualIp(network), '10.88.0.9');
  network.runningConfig = { ...network.savedConfig, ipv4Mode: 'auto' };
  assert.equal(activeVirtualIp(network), network.virtualIp);
});
