// Test-only Tauri Adapter; load through agent-browser --init-script before open.
// It never creates a core process, adapter or external network connection.
(() => {
  window.isTauri = true;
  window.__telemetryTest = { fail: false, operations: [] };
  let epoch = 0;
  const profile = (id, name, ip) => ({ id, client: { alias: name, icon: 'work', autoConnect: false }, config: {
    name, secret: 'test-only', servers: ['tcp://example.com:11010'], hostname: 'actual-test-node',
    ipv4Mode: 'auto', ipv4Address: '', ipv4Prefix: 24, tunName: `ct-${name}`, mtu: null, ipv6: true,
    p2pPolicy: 'auto', latencyFirst: false, tcpHolePunching: true, udpHolePunching: true, upnp: true,
    magicDns: false, dnsSuffix: 'et.net.', udpBroadcastRelay: false,
  }, ip });
  const profiles = [profile('11111111-1111-4111-8111-111111111111', 'office', '10.42.0.2'), profile('22222222-2222-4222-8222-222222222222', 'game', '10.56.0.2')];
  let document = { version: 1, revision: 'fixture', selectedId: profiles[0].id, networks: profiles.map(({ ip, ...record }) => record) };
  const sessions = new Map(profiles.map((record, index) => [record.id, { started: performance.now(), session: `session-${index}`, base: (index + 1) * 1024 ** 2, stopped: false }]));
  const snapshot = () => profiles.map((record) => {
    const session = sessions.get(record.id);
    const elapsedMs = Math.floor(performance.now() - session.started);
    const telemetry = session.last && session.stopped ? session.last : {
      session: session.session, elapsedMs, hostname: 'actual-test-node',
      downloadBytes: String(session.base + Math.floor(elapsedMs * 1024)), uploadBytes: String(Math.floor(elapsedMs * 256)), incomplete: false,
      peers: [
        { id: '1', name: 'friend', ip: '10.42.0.3', connection: 'direct', latency: 23.5, lossRate: 0.012, protocols: ['UDP'], nextHop: null, version: '2.6.4-test' },
        { id: '2', name: 'remote', ip: null, connection: 'relay', latency: null, lossRate: null, protocols: [], nextHop: 'friend', version: '2.6.4-test' },
      ],
    };
    session.last = telemetry;
    return { id: record.id, state: session.stopped ? 'stopped' : 'running', runningConfig: session.stopped ? null : record.config,
      deviceName: record.config.tunName, virtualIp: session.stopped ? null : record.ip,
      peerCount: session.stopped ? 0 : 2, directPeerCount: session.stopped ? 0 : 1, error: null, telemetry };
  });
  window.__TAURI_INTERNALS__ = { invoke: async (command, args = {}) => {
    if (command === 'config_load') return structuredClone(document);
    if (command === 'config_save') { document = { ...args.document, revision: String(++epoch) }; return structuredClone(document); }
    if (command === 'network_snapshot') {
      if (window.__telemetryTest.fail) throw { code: 'request_timeout' };
      return snapshot();
    }
    if (command === 'network_operation') {
      const operation = args.operation;
      window.__telemetryTest.operations.push(operation.action);
      if (operation.action === 'stop') sessions.get(operation.id).stopped = true;
      else sessions.set(operation.id, { started: performance.now(), session: `new-${++epoch}`, base: 0, stopped: false });
      return snapshot();
    }
    if (command === 'host_environment') return ['actual-test-node', 'windows'];
    if (command === 'plugin:app|version') return '0.1.0';
    if (command === 'core_version') return '2.6.4-8428a89d';
    throw new Error(`Unexpected command: ${command}`);
  } };
})();
