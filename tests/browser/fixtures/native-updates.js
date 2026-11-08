// Load after native-telemetry and native-desktop. No HTTP, installer, process or
// real filesystem is touched; this fixture only simulates the native Interface.
(() => {
  const original = window.__TAURI_INTERNALS__.invoke;
  const transform = window.__TAURI_INTERNALS__.transformCallback;
  const callbacks = new Map(), listeners = new Map(); let id = 100000;
  window.__TAURI_INTERNALS__.transformCallback = (callback, once) => {
    const key = transform(callback, once); callbacks.set(key, callback); return key;
  };
  const status = { revision: 1, distribution: 'installed', preferences: { automatic: true, prereleases: true },
    phase: 'idle', candidate: null, error: null, lastChecked: null, downloaded: 0, total: null };
  const emit = () => { status.revision++; for (const [eventId, handler] of listeners) callbacks.get(handler)?.({ event: 'updates-changed', id: eventId, payload: structuredClone(status) }); };
  const test = window.__updateTest = { status, opens: [], installs: 0, downloads: 0, failCheck: false, failSignature: false, failCleanup: false, hold: false, token: 0, emit };
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    if (command === 'plugin:event|listen' && args.event === 'updates-changed') { const eventId = ++id; listeners.set(eventId, args.handler); return eventId; }
    if (command === 'plugin:event|unlisten' && listeners.has(args.eventId)) { listeners.delete(args.eventId); return; }
    if (command === 'updates_status') return structuredClone(status);
    if (command !== 'updates_command') return original(command, args);
    const action = args.command;
    if (action.action === 'check') {
      if (test.failCheck) { status.error = 'network'; emit(); throw 'network'; }
      status.lastChecked = Math.floor(Date.now() / 1000); status.error = null;
      status.candidate = { version: '0.2.0-beta.10', notes: '测试更新说明' }; status.phase = 'available';
    } else if (action.action === 'configure') { status.preferences = action.preferences;
    } else if (action.action === 'cancel') { test.token++; status.phase = 'available'; status.error = null;
    } else if (action.action === 'openZip' || action.action === 'openRelease') { test.opens.push(action.action);
    } else if (action.action === 'update') {
      if (status.distribution !== 'installed') throw 'portable';
      if (!action.confirmed) {
        const token = ++test.token; test.downloads++; status.phase = 'downloading'; status.downloaded = 40; status.total = 100; status.error = null; emit();
        while (test.hold && token === test.token) await new Promise(resolve => setTimeout(resolve, 20));
        if (token !== test.token) throw 'cancelled';
        if (test.failSignature) { status.error = 'signature'; status.phase = 'available'; emit(); throw 'signature'; }
        status.phase = 'ready';
      } else {
        if (test.failCleanup) { status.error = 'cleanup'; emit(); throw 'cleanup'; }
        test.installs++; status.phase = 'installing';
      }
    }
    emit(); return structuredClone(status);
  };
})();
