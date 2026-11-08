import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { configurationDraft, configsEqual, draftConfig, hasPendingConfig, serverAddresses, serverSummary, validateDraft } from '../src/features/networks/configuration.ts';
import { demoNetworks } from '../src/features/networks/demo.ts';
import { createNetworkStore } from '../src/features/networks/network-store.ts';

let networkStore;
let pending;
const network = (id = 'office') => networkStore.getState().networks.find((item) => item.id === id);
beforeEach(() => {
  pending = [];
  networkStore = createNetworkStore(demoNetworks, (operation) => new Promise((resolve, reject) => {
    pending.push({ operation, resolve, reject });
  }));
});
const finish = (operation) => {
  pending.splice(0).forEach((request) => request.resolve());
  return operation;
};

test('address input accepts multiple URI addresses, removes blank lines and exact duplicates', () => {
  assert.deepEqual(serverAddresses(' tcp://host.example:11010 \r\n\nudp://[::1]:11010\ntcp://host.example:11010'),
    ['tcp://host.example:11010', 'udp://[::1]:11010']);
  for (const address of ['tcp://host.example:11010', 'udp://[::1]:11010', 'wss://host.example/path?token=demo']) {
    assert.deepEqual(validateDraft({ ...configurationDraft(network()), servers: address }), {});
  }
});

test('missing identity and malformed server addresses fail validation', () => {
  const draft = configurationDraft(network());
  assert.equal(validateDraft({ ...draft, name: '  ' }).name, 'nameRequired');
  assert.equal(validateDraft({ ...draft, servers: '\n ' }).servers, 'serversRequired');
  for (const servers of ['host:11010', 'tcp://', 'tcp://host:abc', 'tcp://host:65536', 'tcp://host:0', 'tcp://bad host:11010']) {
    assert.equal(validateDraft({ ...draft, servers }).servers, 'serverInvalid', servers);
  }
});

test('normalizing the editor preserves exact network credentials and unedited config fields', () => {
  const draft = { ...configurationDraft(network()), name: ' exact name ', secret: ' key with spaces ' };
  const config = draftConfig(draft, { ...network().savedConfig, futureOption: true });
  assert.equal(config.name, draft.name);
  assert.equal(config.secret, draft.secret);
  assert.equal(config.futureOption, true);
  assert.deepEqual(validateDraft({ ...draft, secret: '' }), {});
  assert.equal(draftConfig({ ...draft, secret: '' }, config).secret, '');
});

test('server summaries omit credentials and URL query tokens', () => {
  assert.equal(serverSummary('wss://user:password@relay.example:443/path?token=private#secret'), 'wss://relay.example');
});

test('alias-only saves update immediately without changing the active session or traffic', async () => {
  const original = structuredClone(network());
  assert.equal((await networkStore.getState().saveConfiguration('office', { ...configurationDraft(original), alias: '工作' }, 'later')).status, 'saved');
  assert.equal(network().alias, '工作');
  assert.equal(network().coreState, 'running');
  assert.equal(hasPendingConfig(network()), false);
  assert.deepEqual(network().runningConfig, original.runningConfig);
  assert.deepEqual(network().trafficTotals, original.trafficTotals);
});

test('save for later preserves active parameters, counters, and other networks; reverting clears pending', async () => {
  const original = structuredClone(network());
  const gaming = structuredClone(network('gaming'));
  const store = networkStore.getState();
  await store.saveConfiguration('office', { ...configurationDraft(original), name: 'new-name', secret: 'new-key' }, 'later');
  assert.equal(network().savedConfig.name, 'new-name');
  assert.deepEqual(network().runningConfig, original.runningConfig);
  assert.deepEqual(network().trafficTotals, original.trafficTotals);
  assert.equal(network().coreState, 'running');
  assert.equal(hasPendingConfig(network()), true);
  assert.deepEqual(network('gaming'), gaming);
  await store.saveConfiguration('office', configurationDraft(original), 'later');
  assert.equal(hasPendingConfig(network()), false);
});

test('apply reconnects only the edited network, clears pending and resets only its session counters', async () => {
  const store = networkStore.getState();
  const gaming = structuredClone(network('gaming'));
  const home = structuredClone(network('home'));
  await store.saveConfiguration('office', { ...configurationDraft(network()), name: 'new-name' }, 'later');
  const applying = await store.saveConfiguration('office', configurationDraft(network()), 'now');
  assert.equal(applying.status, 'applying');
  assert.equal(network().coreState, 'starting');
  assert.equal(network().runningConfig.name, 'studio-work');
  assert.equal((await store.saveConfiguration('office', configurationDraft(network()), 'later')).status, 'busy');
  assert.equal((await store.saveConfiguration('office', configurationDraft(network()), 'now')).status, 'busy');
  await store.toggleConnection('office');
  assert.equal(network().coreState, 'starting');
  assert.equal(await finish(applying.completion), true);
  assert.equal(network().coreState, 'running');
  assert.equal(configsEqual(network().savedConfig, network().runningConfig), true);
  assert.equal(hasPendingConfig(network()), false);
  assert.deepEqual(network().trafficTotals, { downloadBytes: 0, uploadBytes: 0 });
  assert.deepEqual(network('gaming'), gaming);
  assert.deepEqual(network('home'), home);
});

test('offline saves do not connect; next connection uses saved parameters', async () => {
  const store = networkStore.getState();
  await store.saveConfiguration('home', { ...configurationDraft(network('home')), alias: '', name: 'new-home' }, 'later');
  assert.equal(network('home').alias, 'new-home');
  assert.equal(network('home').coreState, 'stopped');
  assert.equal(network('home').runningConfig, null);
  assert.equal(hasPendingConfig(network('home')), false);
  assert.equal((await store.saveConfiguration('home', configurationDraft(network('home')), 'now')).status, 'saved');
  await finish(store.toggleConnection('home'));
  assert.equal(network('home').runningConfig.name, 'new-home');
  assert.equal(network('home').coreState, 'running');
});

test('disconnect keeps saved edits, and reconnect applies pending configuration', async () => {
  const store = networkStore.getState();
  await store.saveConfiguration('office', { ...configurationDraft(network()), secret: 'next-key' }, 'later');
  const totals = structuredClone(network().trafficTotals);
  await finish(store.toggleConnection('office'));
  assert.equal(network().runningConfig, null);
  assert.equal(network().savedConfig.secret, 'next-key');
  assert.deepEqual(network().trafficTotals, totals);
  await finish(store.toggleConnection('office'));
  assert.equal(network().runningConfig.secret, 'next-key');
  assert.equal(hasPendingConfig(network()), false);
});

test('invalid saves leave the store untouched', async () => {
  const original = structuredClone(networkStore.getState().networks);
  assert.equal((await networkStore.getState().saveConfiguration('office', { ...configurationDraft(network()), name: '' }, 'later')).status, 'invalid');
  assert.deepEqual(networkStore.getState().networks, original);
});

test('quick reconnect works without edits and only restarts its target session', async () => {
  const store = networkStore.getState();
  const others = structuredClone(store.networks.filter((item) => item.id !== 'office'));
  const config = structuredClone(network().runningConfig);
  const reconnecting = store.reconnect('office');
  assert.equal(network().coreState, 'starting');
  assert.equal(await store.reconnect('office'), false);
  await store.toggleConnection('office');
  assert.equal(network().coreState, 'starting');
  assert.equal(await finish(reconnecting), true);
  assert.equal(network().coreState, 'running');
  assert.deepEqual(network().runningConfig, config);
  assert.deepEqual(network().trafficTotals, { downloadBytes: 0, uploadBytes: 0 });
  assert.deepEqual(networkStore.getState().networks.filter((item) => item.id !== 'office'), others);
  assert.equal(networkStore.getState().selectedId, 'office');
});

test('quick reconnect applies pending parameters to the captured target even after selection changes', async () => {
  const store = networkStore.getState();
  await store.saveConfiguration('office', { ...configurationDraft(network()), name: 'pending-office' }, 'later');
  const reconnecting = store.reconnect('office');
  await store.selectNetwork('gaming');
  assert.equal(await finish(reconnecting), true);
  assert.equal(network().runningConfig.name, 'pending-office');
  assert.equal(hasPendingConfig(network()), false);
  assert.equal(network('gaming').runningConfig.name, 'weekend-party');
  assert.equal(networkStore.getState().selectedId, 'gaming');
});

test('quick reconnect never starts offline networks or interrupts a disconnect', async () => {
  const store = networkStore.getState();
  const home = structuredClone(network('home'));
  assert.equal(await store.reconnect('home'), false);
  assert.equal(await store.reconnect('missing'), false);
  assert.deepEqual(network('home'), home);
  const disconnecting = store.toggleConnection('office');
  assert.equal(network().coreState, 'stopping');
  assert.equal(await store.reconnect('office'), false);
  await finish(disconnecting);
  assert.equal(network().coreState, 'stopped');
});

test('icon-only saves update local presentation without reconnecting or changing session data', async () => {
  const original = structuredClone(network());
  const others = structuredClone(networkStore.getState().networks.filter((item) => item.id !== 'office'));
  assert.equal((await networkStore.getState().saveConfiguration('office', { ...configurationDraft(original), icon: 'dns' }, 'later')).status, 'saved');
  assert.equal(network().icon, 'dns');
  assert.equal(network().coreState, 'running');
  assert.equal(hasPendingConfig(network()), false);
  assert.deepEqual(network().savedConfig, original.savedConfig);
  assert.deepEqual(network().runningConfig, original.runningConfig);
  assert.deepEqual(network().trafficTotals, original.trafficTotals);
  assert.deepEqual(networkStore.getState().networks.filter((item) => item.id !== 'office'), others);
});

test('icon edits preserve pending connection parameters without applying them', async () => {
  const store = networkStore.getState();
  await store.saveConfiguration('office', { ...configurationDraft(network()), name: 'next-network' }, 'later');
  const active = structuredClone(network().runningConfig);
  const totals = structuredClone(network().trafficTotals);
  await store.saveConfiguration('office', { ...configurationDraft(network()), icon: 'public' }, 'later');
  assert.equal(network().icon, 'public');
  assert.equal(hasPendingConfig(network()), true);
  assert.equal(network().savedConfig.name, 'next-network');
  assert.deepEqual(network().runningConfig, active);
  assert.deepEqual(network().trafficTotals, totals);
});

test('unsupported icons are rejected without mutating a network', async () => {
  const original = structuredClone(network());
  const draft = { ...configurationDraft(original), icon: 'not-a-network-icon' };
  assert.equal(validateDraft(draft).icon, 'iconInvalid');
  assert.equal((await networkStore.getState().saveConfiguration('office', draft, 'later')).status, 'invalid');
  assert.deepEqual(network(), original);
});

test('advanced edits participate in pending comparison and are retained through apply', async () => {
  const store = networkStore.getState();
  const original = structuredClone(network());
  const draft = { ...configurationDraft(original), hostname: 'office-pc', ipv4Mode: 'manual',
    ipv4Address: '10.88.0.9', ipv4Prefix: '24', mtu: '1300', ipv6: false,
    p2pPolicy: 'disabled', tcpHolePunching: false, udpHolePunching: false, upnp: false,
    magicDns: true, dnsSuffix: 'office.lan.', latencyFirst: true, udpBroadcastRelay: true };
  assert.equal((await store.saveConfiguration('office', draft, 'later')).status, 'saved');
  assert.equal(hasPendingConfig(network()), true);
  assert.deepEqual(network().runningConfig, original.runningConfig);
  assert.equal(network().savedConfig.hostname, 'office-pc');
  assert.equal(network().savedConfig.mtu, 1300);
  assert.equal(network().savedConfig.p2pPolicy, 'disabled');
  const applying = await store.saveConfiguration('office', configurationDraft(network()), 'now');
  assert.equal(applying.status, 'applying');
  assert.equal(await finish(applying.completion), true);
  assert.equal(hasPendingConfig(network()), false);
  assert.equal(network().runningConfig.ipv4Address, '10.88.0.9');
  assert.equal(network().runningConfig.magicDns, true);
  assert.equal(network().runningConfig.udpBroadcastRelay, true);
});

test('each advanced field independently marks saved changes as pending', () => {
  const original = network();
  const changes = { hostname: 'custom-pc', ipv4Mode: 'manual', ipv4Address: '10.88.0.9', ipv4Prefix: 25,
    tunName: 'ct-custom', mtu: 1300, ipv6: false, p2pPolicy: 'lazy', latencyFirst: true,
    tcpHolePunching: false, udpHolePunching: false, upnp: false,
    magicDns: true, dnsSuffix: 'office.lan.', udpBroadcastRelay: true };
  for (const [field, value] of Object.entries(changes)) {
    assert.equal(hasPendingConfig({ ...original, savedConfig: { ...original.savedConfig, [field]: value } }), true, field);
  }
});

test('manual addresses, hostname, MTU and DNS have meaningful validation', () => {
  const draft = configurationDraft(network());
  for (const ipv4Address of ['999.1.2.3', '10.1.2', '10.01.2.3', '0.0.0.0', '127.0.0.1', '224.0.0.1']) {
    assert.equal(validateDraft({ ...draft, ipv4Mode: 'manual', ipv4Address }).ipv4Address, 'ipv4Invalid', ipv4Address);
  }
  for (const ipv4Prefix of ['0', '33', '24.5', '']) {
    assert.equal(validateDraft({ ...draft, ipv4Mode: 'manual', ipv4Address: '10.0.0.2', ipv4Prefix }).ipv4Prefix, 'prefixInvalid');
  }
  for (const mtu of ['399', '1381', 'abc', '1300.5']) assert.equal(validateDraft({ ...draft, mtu }).mtu, 'mtuInvalid');
  for (const mtu of ['', '400', '1380']) assert.equal(validateDraft({ ...draft, mtu }).mtu, undefined);
  assert.equal(validateDraft({ ...draft, hostname: 'a'.repeat(33) }).hostname, 'hostnameInvalid');
  assert.equal(validateDraft({ ...draft, hostname: 'bad\nname' }).hostname, 'hostnameInvalid');
  assert.equal(validateDraft({ ...draft, magicDns: true, dnsSuffix: '-bad..name' }).dnsSuffix, 'dnsInvalid');
  assert.equal(validateDraft({ ...draft, magicDns: true, dnsSuffix: 'office.lan.' }).dnsSuffix, undefined);
  assert.equal(validateDraft({ ...draft, magicDns: false, dnsSuffix: '' }).dnsSuffix, undefined);
  assert.equal(validateDraft({ ...draft, p2pPolicy: 'forced-relay' }).p2pPolicy, 'p2pInvalid');
});

test('manual TUN names are validated and cannot duplicate another saved network', async () => {
  const draft = configurationDraft(network());
  for (const tunName of ['', 'too-long-interface', 'ct name', '中文名称']) assert.equal(validateDraft({ ...draft, tunName }).tunName, 'tunInvalid');
  const otherName = network('home').savedConfig.tunName.toUpperCase();
  assert.equal(validateDraft({ ...draft, tunName: otherName }, [network('home').savedConfig.tunName]).tunName, 'tunDuplicate');
  assert.equal((await networkStore.getState().saveConfiguration('office', { ...draft, tunName: otherName }, 'later')).status, 'invalid');
});

test('automatic hostname/MTU can be restored and local fields never leak into core config', () => {
  const draft = { ...configurationDraft(network()), hostname: '  ', mtu: '', alias: 'local-only', icon: 'dns' };
  const config = draftConfig(draft, network().savedConfig);
  assert.equal(config.hostname, null);
  assert.equal(config.mtu, null);
  assert.equal(Object.hasOwn(config, 'alias'), false);
  assert.equal(Object.hasOwn(config, 'icon'), false);
  assert.equal(draftConfig({ ...draft, p2pPolicy: 'only', latencyFirst: true }, config).latencyFirst, false);
});

test('online core edits require confirmation without changing saved data or starting the runtime', async () => {
  const before = structuredClone(network());
  const result = await networkStore.getState().saveConfiguration('office', { ...configurationDraft(before), name: 'next' });
  assert.deepEqual(result, { status: 'confirmation-required' });
  assert.deepEqual(network(), before);
  assert.equal(pending.length, 0);
});

test('confirming apply saves and starts exactly the target with the submitted parameters', async () => {
  const draft = { ...configurationDraft(network()), hostname: 'new-host', name: 'new-network' };
  const result = await networkStore.getState().saveConfiguration('office', draft, 'now');
  assert.equal(result.status, 'applying');
  assert.equal(network().savedConfig.hostname, 'new-host');
  assert.equal(network().runningConfig.hostname, null);
  assert.equal(pending.length, 1);
  assert.equal(pending[0].operation.action, 'restart');
  assert.equal(pending[0].operation.id, 'office');
  assert.equal(pending[0].operation.config.name, 'new-network');
  assert.equal(await finish(result.completion), true);
  assert.equal(hasPendingConfig(network()), false);
});

test('local-only edits preserve pending parameters and never request confirmation or restart', async () => {
  const store = networkStore.getState();
  await store.saveConfiguration('office', { ...configurationDraft(network()), name: 'next' }, 'later');
  const result = await store.saveConfiguration('office', { ...configurationDraft(network()), icon: 'public' });
  assert.deepEqual(result, { status: 'saved', pending: true });
  assert.equal(network().icon, 'public');
  assert.equal(network().runningConfig.name, 'studio-work');
  assert.equal(pending.length, 0);
});

test('save results distinguish invalid, missing and busy targets', async () => {
  const store = networkStore.getState();
  const draft = configurationDraft(network());
  const invalid = await store.saveConfiguration('office', { ...draft, name: '' });
  assert.deepEqual(invalid, { status: 'invalid', errors: { name: 'nameRequired' } });
  assert.deepEqual((await store.saveConfiguration('missing', draft)), { status: 'missing' });
  const restarting = store.reconnect('office');
  assert.deepEqual((await store.saveConfiguration('office', draft)), { status: 'busy' });
  await finish(restarting);
});

test('runtime rejection restores session state while preserving saved edits and concurrent preferences', async () => {
  const store = networkStore.getState();
  const before = structuredClone(network());
  const others = structuredClone(store.networks.filter((item) => item.id !== 'office'));
  const result = await store.saveConfiguration('office', { ...configurationDraft(before), name: 'next' }, 'now');
  assert.equal(result.status, 'applying');
  await store.setAutoConnect('office', false);
  pending.shift().reject(new Error('runtime unavailable'));
  assert.equal(await result.completion, false);
  assert.equal(network().coreState, 'running');
  assert.deepEqual(network().runningConfig, before.runningConfig);
  assert.deepEqual(network().trafficTotals, before.trafficTotals);
  assert.equal(network().savedConfig.name, 'next');
  assert.equal(network().autoConnect, false);
  assert.equal(hasPendingConfig(network()), true);
  assert.deepEqual(networkStore.getState().networks.filter((item) => item.id !== 'office'), others);
});

test('store instances never share configuration, selection or runtime state', async () => {
  const other = createNetworkStore(demoNetworks, async () => {});
  await networkStore.getState().saveConfiguration('office', { ...configurationDraft(network()), alias: 'local' });
  await networkStore.getState().selectNetwork('gaming');
  assert.equal(other.getState().selectedId, 'office');
  assert.equal(other.getState().networks[0].alias, '远程办公室');
  assert.equal(demoNetworks[0].alias, '远程办公室');
});

test('concurrent network transitions acknowledge and complete independently', async () => {
  const store = networkStore.getState();
  const office = store.reconnect('office');
  const home = store.toggleConnection('home');
  assert.equal(network().coreState, 'starting');
  assert.equal(network('home').coreState, 'starting');
  const officeRequest = pending.find((request) => request.operation.id === 'office');
  const homeRequest = pending.find((request) => request.operation.id === 'home');
  officeRequest.resolve();
  assert.equal(await office, true);
  assert.equal(network().coreState, 'running');
  assert.equal(network('home').coreState, 'starting');
  homeRequest.resolve();
  assert.equal(await home, true);
  assert.equal(network('home').coreState, 'running');
  assert.equal(network('gaming').coreState, 'running');
});
