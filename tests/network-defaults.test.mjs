import assert from 'node:assert/strict';
import test from 'node:test';
import { defaultTunName } from '../src/features/networks/defaults.ts';
import { activeVirtualIp } from '../src/features/networks/model.ts';
import { createMockNetworks } from '../dev/mock-networks.ts';
const mock = createMockNetworks(async () => {});
const mockNetworks = (await mock.storage.load()).networks;

test('generated TUN names are stable, short, unique between mock networks and case-insensitive collision aware', () => {
  const names = mockNetworks.map((network) => defaultTunName(network.id));
  assert.equal(new Set(names).size, mockNetworks.length);
  for (const network of mockNetworks) {
    const name = defaultTunName(network.id);
    assert.match(name, /^[a-z\d-]{1,15}$/);
    assert.equal(defaultTunName(network.id), name);
    assert.notEqual(defaultTunName(network.id, [name.toUpperCase()]), name);
    const next = defaultTunName(network.id, [name, `${name}-1`]);
    assert.notEqual(next, `${name}-1`);
    assert.ok(next.length <= 15);
  }
});

test('displayed IP always follows the actual observation rather than saved or desired parameters', () => {
  const network = {
    virtualIp: '10.42.0.2',
    savedConfig: { ipv4Address: '10.88.0.9' },
    runningConfig: { ipv4Address: '10.99.0.2' },
  };
  assert.equal(activeVirtualIp(network), '10.42.0.2');
});
