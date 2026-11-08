import assert from 'node:assert/strict';
import test from 'node:test';
import { configurationDraft, configsEqual, draftConfig, hasPendingConfig, serverAddresses, serverSummary, validateDraft } from '../src/features/networks/configuration.ts';
import { fixture, profile } from './helpers/networks.mjs';
const office = profile('office', 'office');
office.coreState = 'running'; office.runningConfig = structuredClone(office.savedConfig);
const home = profile('home', 'home');
const network = (id = 'office') => id === 'home' ? home : office;

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
  const f = fixture([office, home]); await f.store.getState().initialize();
  assert.equal((await f.store.getState().save('office', { ...configurationDraft(f.get('office')), tunName: otherName })).status, 'invalid');
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

test('configuration comparison covers extension fields independent of object insertion order', () => {
  const config = network().savedConfig;
  assert.equal(configsEqual({ ...config, future: { a: 1, b: 2 } }, { future: { b: 2, a: 1 }, ...config }), true);
  assert.equal(configsEqual({ ...config, future: true }, config), false);
});
