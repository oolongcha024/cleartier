import assert from 'node:assert/strict';
import test from 'node:test';
import { encodeInvitation, decodeInvitation, fillInvitation, invitationSource, InvitationError, maxInvitationInput } from '../src/features/invitations/invitation.ts';
import { shareInvitation } from '../src/features/invitations/share-invitation.ts';
import { demoNetworks } from '../src/features/networks/demo.ts';
import { configurationDraft } from '../src/features/networks/configuration.ts';
import { createNetworkStore, newNetworkDraft } from '../src/features/networks/network-store.ts';

const details = { name: ' 办公 🎮 ', secret: ' "密钥"\n with spaces ', servers: ['tcp://example.com:11010', 'udp://[2001:db8::1]:11010'], displayName: '朋友的办公室' };
const encoded = value => 'cleartier:v1:' + Buffer.from(JSON.stringify(value)).toString('base64url');
const error = code => failure => failure instanceof InvitationError && failure.code === code;
const parameters = async (_id, config) => ({ name: config.name, secret: config.secret, servers: config.servers });

test('v1 round trip preserves exact Unicode identity/credentials and can be pasted from chat prose', () => {
  const code = encodeInvitation(details);
  assert.deepEqual(decodeInvitation(code), details);
  for (const text of [`邀请：\n${code}\n粘贴到 ClearTier 加入网络`, `「${code}」`, `\`${code}\``, `（${code}）。`]) {
    assert.deepEqual(decodeInvitation(text), details);
  }
  assert.deepEqual(decodeInvitation(encodeInvitation({ ...details, secret: '', servers: [details.servers[0], details.servers[0]] })).servers, [details.servers[0]]);
});

test('only membership and optional display name belong to v1, never local settings or prototype keys', () => {
  for (const field of ['hostname', 'tunName', 'ipv4Address', 'p2pPolicy', 'mtu', 'officialToml', '__proto__']) {
    const value = JSON.parse(JSON.stringify(details));
    Object.defineProperty(value, field, { value: 'must-not-travel', enumerable: true });
    assert.throws(() => decodeInvitation(encoded(value)), error('unsupportedFields'), field);
  }
  for (const value of [null, [], 42, { ...details, secret: null }, { ...details, servers: 'tcp://example.com' }, { ...details, name: ' ' }, { ...details, displayName: 'bad\nname' }]) {
    assert.throws(() => decodeInvitation(encoded(value)), error('invalid'));
  }
});

test('format/version/size checks reject truncation, invalid UTF-8, ambiguous paste and oversized input', () => {
  const code = encodeInvitation(details);
  assert.throws(() => decodeInvitation(code.replace(':v1:', ':v2:')), error('unsupportedVersion'));
  assert.throws(() => decodeInvitation(code.slice(0, -8)), error('invalid'));
  assert.throws(() => decodeInvitation(code + '='), error('invalid'));
  assert.throws(() => decodeInvitation('cleartier:v1:_w'), error('invalid'));
  assert.throws(() => decodeInvitation(code + '\n' + code), error('multiple'));
  assert.throws(() => decodeInvitation('x'.repeat(maxInvitationInput + 1)), error('tooLarge'));
  assert.throws(() => encodeInvitation({ ...details, servers: Array(17).fill('tcp://example.com') }), error('tooLarge'));
});

test('invitations require remote-capable endpoints and never initiate URL requests during parsing', () => {
  for (const address of ['tcp://0.0.0.0:11010', 'udp://[::]:11010', 'tcp://127.0.0.1:11010', 'tcp://localhost:11010', 'udp://[::1]:11010', 'file:///tmp/network', 'javascript:alert(1)', 'tcp://example.com:0', 'tcp://example.com:99999', 'ring://local', 'tcp://bad host:11010']) {
    assert.throws(() => decodeInvitation(encoded({ ...details, servers: [address] })), error('invalidServer'), address);
  }
  assert.throws(() => encodeInvitation({ ...details, servers: [] }), error('missingServers'));
  for (const address of ['tcp://192.168.1.2:11010', 'wss://example.com/path?token=test', 'txt://example.com', 'srv://_easytier._tcp.example.com']) {
    assert.equal(decodeInvitation(encodeInvitation({ ...details, servers: [address] })).servers[0], address);
  }
});

test('running parameters win over unapplied saved edits; offline profiles share saved parameters', () => {
  const network = structuredClone(demoNetworks[0]);
  network.savedConfig = { ...network.savedConfig, secret: 'pending-new-secret' };
  assert.equal(invitationSource(network).config.secret, network.runningConfig.secret);
  assert.equal(invitationSource(network).pending, true);
  network.coreState = 'stopped'; network.runningConfig = null;
  assert.equal(invitationSource(network).config.secret, 'pending-new-secret');
  assert.equal(invitationSource(network).pending, false);
  network.coreState = 'failed';
  assert.equal(invitationSource(network).config.secret, 'pending-new-secret');
  for (const state of ['unknown', 'starting', 'stopping', 'running']) {
    network.coreState = state;
    assert.throws(() => invitationSource(network), error('unavailable'), state);
  }
});

test('sharing does not alter profiles, operate the core, or silently copy a stale source', async () => {
  let network = structuredClone(demoNetworks[0]);
  network.savedConfig = { ...network.savedConfig, secret: 'pending-secret' };
  const before = structuredClone(network);
  let clipboard;
  const result = await shareInvitation(() => network, { parameters, copy: async text => { clipboard = text; return true; } });
  assert.equal(result.pending, true);
  assert.equal(decodeInvitation(clipboard).secret, network.runningConfig.secret);
  assert.deepEqual(network, before);
  clipboard = undefined;
  await assert.rejects(shareInvitation(() => network, {
    parameters: async (id, config) => {
      network = { ...network, runningConfig: { ...network.runningConfig, secret: 'changed-during-extraction' } };
      return parameters(id, config);
    }, copy: async text => { clipboard = text; return true; },
  }), error('changed'));
  assert.equal(clipboard, undefined);
  await assert.rejects(shareInvitation(() => network, {
    parameters: async (id, config) => {
      network.runningConfig.secret = 'changed-in-place';
      return parameters(id, config);
    }, copy: async text => { clipboard = text; return true; },
  }), error('changed'));
  assert.equal(clipboard, undefined);
});

test('clipboard failure retains a valid manual-copy invitation without claiming success', async () => {
  const network = structuredClone(demoNetworks[0]);
  const result = await shareInvitation(() => network, { parameters, copy: async () => { throw new Error('clipboard denied'); } });
  assert.equal(result.copied, false);
  assert.equal(decodeInvitation(result.text).name, network.runningConfig.name);
});

test('autofill preserves receiver settings and manual alias, replaces only membership fields', () => {
  const network = newNetworkDraft([]);
  const draft = { ...configurationDraft(network), hostname: 'receiver', tunName: 'ct-receiver', mtu: '1200', p2pPolicy: 'disabled', alias: '本地备注' };
  const next = fillInvitation(draft, details);
  assert.deepEqual({ ...next, name: draft.name, secret: draft.secret, servers: draft.servers }, draft);
  const empty = { ...draft, alias: '' };
  const first = fillInvitation(empty, details);
  assert.equal(first.alias, details.displayName);
  const second = fillInvitation(first, { ...details, displayName: '另一个建议' }, details.displayName);
  assert.equal(second.alias, '另一个建议');
  assert.equal(fillInvitation({ ...first, alias: '我的备注' }, { ...details, displayName: '其他' }, details.displayName).alias, '我的备注');
});

test('adding an invitation uses a new local identity, only persists once, and remains manually connected', async () => {
  const operations = [];
  const store = createNetworkStore([], async operation => { operations.push(operation); });
  const candidate = newNetworkDraft(store.getState().networks);
  const draft = fillInvitation(configurationDraft(candidate), decodeInvitation(encodeInvitation(details)));
  assert.equal((await store.getState().saveConfiguration(candidate.id, draft, 'confirm', true)).status, 'saved');
  const network = store.getState().networks[0];
  assert.equal(network.savedConfig.name, details.name);
  assert.equal(network.savedConfig.secret, details.secret);
  assert.equal(network.savedConfig.hostname, null);
  assert.equal(network.savedConfig.tunName, candidate.savedConfig.tunName);
  assert.equal(network.savedConfig.ipv4Mode, 'auto');
  assert.equal(network.savedConfig.mtu, null);
  assert.equal(network.savedConfig.p2pPolicy, 'auto');
  assert.equal(network.savedConfig.officialToml, undefined);
  assert.equal(network.coreState, 'stopped');
  assert.equal(network.autoConnect, false);
  assert.equal(store.getState().selectedId, candidate.id);
  assert.deepEqual(operations, []);
});
