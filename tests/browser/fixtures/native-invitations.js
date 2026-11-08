// Load after native-telemetry.js. Only in-memory, test-owned clipboard data is
// used; neither OS clipboard nor real core processes are accessed.
(() => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__invitationTest = {
    writes: [],
    parameters: [],
    failCopy: false,
    failParameters: false,
    connections: [],
  };
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    const test = window.__invitationTest;
    if (command === 'invitation_parameters') {
      test.parameters.push(structuredClone(args));
      if (test.failParameters) throw 'unsupportedConfiguration';
      return { name: args.config.name, secret: args.config.secret, servers: args.config.servers };
    }
    if (command === 'plugin:clipboard-manager|write_text') {
      if (test.failCopy) throw 'clipboard-denied';
      test.writes.push(args.text);
      return;
    }
    if (
      command === 'network_operation' &&
      !['11111111-1111-4111-8111-111111111111', '22222222-2222-4222-8222-222222222222'].includes(
        args.operation.id,
      )
    ) {
      test.connections.push(structuredClone(args.operation));
      throw { code: 'tun_failed' };
    }
    return invoke(command, args);
  };
})();
