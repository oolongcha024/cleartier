import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';
import { configurationDraft, configsEqual, draftConfig, hasPendingConfig, serverAddresses, serverSummary, validateDraft } from '../src/features/networks/configuration.ts';
import { demoNetworks } from '../src/features/networks/demo.ts';
import { useNetworkStore } from '../src/features/networks/store.ts';

const network = (id = 'office') => useNetworkStore.getState().networks.find((item) => item.id === id);
beforeEach(() => useNetworkStore.setState({ networks: structuredClone(demoNetworks), selectedId: 'office' }));

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

test('alias-only saves update immediately without changing the active session or traffic', () => {
  const original = structuredClone(network());
  assert.equal(useNetworkStore.getState().saveConfiguration('office', { ...configurationDraft(original), alias: '工作' }), true);
  assert.equal(network().alias, '工作');
  assert.equal(network().coreState, 'running');
  assert.equal(hasPendingConfig(network()), false);
  assert.deepEqual(network().runningConfig, original.runningConfig);
  assert.deepEqual(network().trafficTotals, original.trafficTotals);
});

test('save for later preserves active parameters, counters, and other networks; reverting clears pending', () => {
  const original = structuredClone(network());
  const gaming = structuredClone(network('gaming'));
  const store = useNetworkStore.getState();
  store.saveConfiguration('office', { ...configurationDraft(original), name: 'new-name', secret: 'new-key' });
  assert.equal(network().savedConfig.name, 'new-name');
  assert.deepEqual(network().runningConfig, original.runningConfig);
  assert.deepEqual(network().trafficTotals, original.trafficTotals);
  assert.equal(network().coreState, 'running');
  assert.equal(hasPendingConfig(network()), true);
  assert.deepEqual(network('gaming'), gaming);
  store.saveConfiguration('office', configurationDraft(original));
  assert.equal(hasPendingConfig(network()), false);
});

test('apply reconnects only the edited network, clears pending and resets only its session counters', async () => {
  const store = useNetworkStore.getState();
  const gaming = structuredClone(network('gaming'));
  const home = structuredClone(network('home'));
  store.saveConfiguration('office', { ...configurationDraft(network()), name: 'new-name' });
  const applying = store.applyConfiguration('office');
  assert.equal(network().coreState, 'starting');
  assert.equal(network().runningConfig.name, 'studio-work');
  assert.equal(store.saveConfiguration('office', configurationDraft(network())), false);
  assert.equal(await store.applyConfiguration('office'), false);
  await store.toggleConnection('office');
  assert.equal(network().coreState, 'starting');
  assert.equal(await applying, true);
  assert.equal(network().coreState, 'running');
  assert.equal(configsEqual(network().savedConfig, network().runningConfig), true);
  assert.equal(hasPendingConfig(network()), false);
  assert.deepEqual(network().trafficTotals, { downloadBytes: 0, uploadBytes: 0 });
  assert.deepEqual(network('gaming'), gaming);
  assert.deepEqual(network('home'), home);
});

test('offline saves do not connect; next connection uses saved parameters', async () => {
  const store = useNetworkStore.getState();
  store.saveConfiguration('home', { ...configurationDraft(network('home')), alias: '', name: 'new-home' });
  assert.equal(network('home').alias, 'new-home');
  assert.equal(network('home').coreState, 'stopped');
  assert.equal(network('home').runningConfig, null);
  assert.equal(hasPendingConfig(network('home')), false);
  assert.equal(await store.applyConfiguration('home'), false);
  await store.toggleConnection('home');
  assert.equal(network('home').runningConfig.name, 'new-home');
  assert.equal(network('home').coreState, 'running');
});

test('disconnect keeps saved edits, and reconnect applies pending configuration', async () => {
  const store = useNetworkStore.getState();
  store.saveConfiguration('office', { ...configurationDraft(network()), secret: 'next-key' });
  const totals = structuredClone(network().trafficTotals);
  await store.toggleConnection('office');
  assert.equal(network().runningConfig, null);
  assert.equal(network().savedConfig.secret, 'next-key');
  assert.deepEqual(network().trafficTotals, totals);
  await store.toggleConnection('office');
  assert.equal(network().runningConfig.secret, 'next-key');
  assert.equal(hasPendingConfig(network()), false);
});

test('invalid saves leave the store untouched', () => {
  const original = structuredClone(useNetworkStore.getState().networks);
  assert.equal(useNetworkStore.getState().saveConfiguration('office', { ...configurationDraft(network()), name: '' }), false);
  assert.deepEqual(useNetworkStore.getState().networks, original);
});

test('quick reconnect works without edits and only restarts its target session', async () => {
  const store = useNetworkStore.getState();
  const others = structuredClone(store.networks.filter((item) => item.id !== 'office'));
  const config = structuredClone(network().runningConfig);
  const reconnecting = store.reconnect('office');
  assert.equal(network().coreState, 'starting');
  assert.equal(await store.reconnect('office'), false);
  await store.toggleConnection('office');
  assert.equal(network().coreState, 'starting');
  assert.equal(await reconnecting, true);
  assert.equal(network().coreState, 'running');
  assert.deepEqual(network().runningConfig, config);
  assert.deepEqual(network().trafficTotals, { downloadBytes: 0, uploadBytes: 0 });
  assert.deepEqual(useNetworkStore.getState().networks.filter((item) => item.id !== 'office'), others);
  assert.equal(useNetworkStore.getState().selectedId, 'office');
});

test('quick reconnect applies pending parameters to the captured target even after selection changes', async () => {
  const store = useNetworkStore.getState();
  store.saveConfiguration('office', { ...configurationDraft(network()), name: 'pending-office' });
  const reconnecting = store.reconnect('office');
  store.selectNetwork('gaming');
  assert.equal(await reconnecting, true);
  assert.equal(network().runningConfig.name, 'pending-office');
  assert.equal(hasPendingConfig(network()), false);
  assert.equal(network('gaming').runningConfig.name, 'weekend-party');
  assert.equal(useNetworkStore.getState().selectedId, 'gaming');
});

test('quick reconnect never starts offline networks or interrupts a disconnect', async () => {
  const store = useNetworkStore.getState();
  const home = structuredClone(network('home'));
  assert.equal(await store.reconnect('home'), false);
  assert.equal(await store.reconnect('missing'), false);
  assert.deepEqual(network('home'), home);
  const disconnecting = store.toggleConnection('office');
  assert.equal(network().coreState, 'stopping');
  assert.equal(await store.reconnect('office'), false);
  await disconnecting;
  assert.equal(network().coreState, 'stopped');
});

test('icon-only saves update local presentation without reconnecting or changing session data', () => {
  const original = structuredClone(network());
  const others = structuredClone(useNetworkStore.getState().networks.filter((item) => item.id !== 'office'));
  assert.equal(useNetworkStore.getState().saveConfiguration('office', { ...configurationDraft(original), icon: 'dns' }), true);
  assert.equal(network().icon, 'dns');
  assert.equal(network().coreState, 'running');
  assert.equal(hasPendingConfig(network()), false);
  assert.deepEqual(network().savedConfig, original.savedConfig);
  assert.deepEqual(network().runningConfig, original.runningConfig);
  assert.deepEqual(network().trafficTotals, original.trafficTotals);
  assert.deepEqual(useNetworkStore.getState().networks.filter((item) => item.id !== 'office'), others);
});

test('icon edits preserve pending connection parameters without applying them', () => {
  const store = useNetworkStore.getState();
  store.saveConfiguration('office', { ...configurationDraft(network()), name: 'next-network' });
  const active = structuredClone(network().runningConfig);
  const totals = structuredClone(network().trafficTotals);
  store.saveConfiguration('office', { ...configurationDraft(network()), icon: 'public' });
  assert.equal(network().icon, 'public');
  assert.equal(hasPendingConfig(network()), true);
  assert.equal(network().savedConfig.name, 'next-network');
  assert.deepEqual(network().runningConfig, active);
  assert.deepEqual(network().trafficTotals, totals);
});

test('unsupported icons are rejected without mutating a network', () => {
  const original = structuredClone(network());
  const draft = { ...configurationDraft(original), icon: 'not-a-network-icon' };
  assert.equal(validateDraft(draft).icon, 'iconInvalid');
  assert.equal(useNetworkStore.getState().saveConfiguration('office', draft), false);
  assert.deepEqual(network(), original);
});

test('advanced edits participate in pending comparison and are retained through apply', async () => {
  const store = useNetworkStore.getState();
  const original = structuredClone(network());
  const draft = { ...configurationDraft(original), hostname: 'office-pc', ipv4Mode: 'manual',
    ipv4Address: '10.88.0.9', ipv4Prefix: '24', mtu: '1300', ipv6: false,
    p2pPolicy: 'disabled', tcpHolePunching: false, udpHolePunching: false, upnp: false,
    magicDns: true, dnsSuffix: 'office.lan.', latencyFirst: true, udpBroadcastRelay: true };
  assert.equal(store.saveConfiguration('office', draft), true);
  assert.equal(hasPendingConfig(network()), true);
  assert.deepEqual(network().runningConfig, original.runningConfig);
  assert.equal(network().savedConfig.hostname, 'office-pc');
  assert.equal(network().savedConfig.mtu, 1300);
  assert.equal(network().savedConfig.p2pPolicy, 'disabled');
  assert.equal(await store.applyConfiguration('office'), true);
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

test('manual TUN names are validated and cannot duplicate another saved network', () => {
  const draft = configurationDraft(network());
  for (const tunName of ['', 'too-long-interface', 'ct name', '中文名称']) assert.equal(validateDraft({ ...draft, tunName }).tunName, 'tunInvalid');
  const otherName = network('home').savedConfig.tunName.toUpperCase();
  assert.equal(validateDraft({ ...draft, tunName: otherName }, [network('home').savedConfig.tunName]).tunName, 'tunDuplicate');
  assert.equal(useNetworkStore.getState().saveConfiguration('office', { ...draft, tunName: otherName }), false);
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
