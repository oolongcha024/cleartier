// Load after native-telemetry.js. This Adapter simulates native dialogs and file
// failures; Rust tests exercise the actual TOML parser and preservation rules.
(() => {
  const invoke = window.__TAURI_INTERNALS__.invoke;
  window.__configurationTest = { cancelPick: false, invalidPick: false, failExport: false, cancelExport: false, exports: [], picks: 0 };
  const inspect = (id, config) => ({ id, config: structuredClone(config),
    issues: config.officialToml?.includes('future_flag') ? [{ path: 'flags.future_flag', code: 'unknown' }] : [],
    preservedFields: ['listeners', 'routes', 'flags.future_flag'] });
  window.__TAURI_INTERNALS__.invoke = async (command, args = {}) => {
    const test = window.__configurationTest;
    if (command === 'toml_import') {
      if (test.cancelPick) return null;
      if (test.invalidPick) throw 'invalid';
      const base = (await invoke('config_load')).networks[0].config;
      return inspect(`33333333-3333-4333-8333-${String(++test.picks).padStart(12, '0')}`, { ...base,
        hostname: 'migrated-node', ipv4Mode: 'manual', ipv4Address: '10.77.0.8', ipv4Prefix: 24,
        officialToml: 'hostname = "migrated-node"\nlisteners = ["tcp://0.0.0.0:11010"]\nroutes = ["192.168.8.0/24"]\n[flags]\nfuture_flag = true\n' });
    }
    if (command === 'toml_inspect') return inspect(args.id, args.config);
    if (command === 'toml_export') {
      if (test.failExport) throw 'io';
      if (test.cancelExport) return false;
      test.exports.push(structuredClone(args)); return true;
    }
    return invoke(command, args);
  };
})();
