// Load after native-telemetry.js. No actual login entry, tray or file is touched.
(() => {
  const original = window.__TAURI_INTERNALS__.invoke;
  let sequence = 0;
  const callbacks = new Map();
  const listeners = new Map();
  window.__telemetryTest.emitWindow = (event, payload) => {
    for (const [id, listener] of listeners) {
      if (listener.event === event) callbacks.get(listener.handler)?.({ event, id, payload });
    }
  };
  const status = {
    preferences: {
      version: 1,
      closeBehavior: 'background',
      closeExplained: false,
      launchAtLogin: false,
      autoRecover: true,
    },
    preferenceError: null,
    autostartError: false,
    trayAvailable: true,
    pending: null,
    quitting: false,
    exitError: null,
  };
  const emit = () => {
    for (const [id, listener] of listeners) {
      if (listener.event === 'desktop-changed')
        callbacks.get(listener.handler)?.({ event: 'desktop-changed', id, payload: null });
    }
  };
  const test = (window.__desktopTest = {
    status,
    updates: [],
    responses: [],
    failSave: false,
    failExport: false,
    cancelExport: false,
    failRespond: false,
    failRead: false,
    failLogs: false,
    logs: 0,
    exports: 0,
    recovery: null,
    request: (kind) => {
      status.pending = { id: ++sequence, kind };
      emit();
    },
    report: {
      generatedAt: Math.floor(Date.now() / 1000),
      appVersion: '0.1.0',
      coreVersion: '2.6.4-8428a89d',
      platform: 'windows',
      architecture: 'x86_64',
      configurationReadable: true,
      preferencesReadable: true,
      processLogsReadable: true,
      coreState: 'ready',
      coreError: null,
      snapshotError: null,
      networks: [
        {
          number: 1,
          state: 'running',
          virtualAddressAssigned: true,
          interfaceExpected: true,
          interfacePresent: true,
          peerCount: 2,
          directPeerCount: 1,
          error: null,
        },
      ],
      recentErrors: [{ time: 1794096000, code: 'core_exited' }],
    },
    emit,
  });
  window.__TAURI_INTERNALS__.transformCallback = (callback) => {
    const id = ++sequence;
    callbacks.set(id, callback);
    return id;
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = {
    unregisterListener: (_event, id) => listeners.delete(id),
  };
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (command === 'plugin:event|listen') {
      const id = ++sequence;
      listeners.set(id, { event: args.event, handler: args.handler });
      return id;
    }
    if (command === 'plugin:event|unlisten') {
      listeners.delete(args.eventId);
      return;
    }
    if (command === 'desktop_status') return structuredClone(status);
    if (command === 'desktop_update') {
      test.updates.push(structuredClone(args.update));
      if (test.failSave) throw 'preferences';
      status.preferences = { ...status.preferences, ...args.update };
      emit();
      return structuredClone(status);
    }
    if (command === 'desktop_exit') {
      test.request('exit');
      return;
    }
    if (command === 'desktop_respond') {
      if (test.failRespond) throw 'io';
      if (status.pending?.id !== args.requestId) throw 'stale';
      test.responses.push(structuredClone(args));
      if (args.choice === 'background') status.preferences.closeExplained = true;
      if (args.choice === 'exit' && status.pending.kind === 'close') {
        test.request('exit');
        return;
      }
      status.pending = null;
      emit();
      return;
    }
    if (command === 'diagnostics_read') {
      if (test.failRead) throw 'io';
      return structuredClone(test.report);
    }
    if (command === 'diagnostics_export') {
      if (test.failExport) throw 'io';
      if (test.cancelExport) return false;
      test.exports++;
      return true;
    }
    if (command === 'logs_open') {
      if (test.failLogs) throw 'io';
      test.logs++;
      return;
    }
    if (command === 'network_operation') test.recovery = null;
    const result = await original(command, args);
    if (command === 'network_snapshot' && test.recovery) {
      result.networks[0] = {
        ...result.networks[0],
        state: test.recovery.phase === 'starting' ? 'starting' : 'failed',
        runningConfig: null,
        recoveryConfig: result.networks[0].runningConfig,
        recovery: test.recovery,
        error: { code: 'core_exited' },
      };
    }
    return result;
  };
})();
