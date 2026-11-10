import type { UpdateAdapter, UpdateSnapshot } from '../src/platform/contracts.ts';

export function createMockUpdates(preset = 'idle') {
  const listeners = new Set<(snapshot: UpdateSnapshot) => void>();
  let disposed = false;
  const status: UpdateSnapshot = {
    revision: 1,
    distribution:
      preset === 'portable' ? 'portable' : preset === 'unsupported' ? 'unsupported' : 'installed',
    preferences: { automatic: true, prereleases: true },
    phase: 'idle',
    candidate: null,
    error: null,
    lastChecked: null,
    retryAt: null,
    downloaded: 0,
    total: null,
  };
  const emit = () => {
    if (disposed) return;
    status.revision++;
    for (const receive of listeners) receive(structuredClone(status));
  };
  const control = {
    status,
    emit,
    opens: [] as string[],
    installs: 0,
    downloads: 0,
    failCheck: preset === 'failed',
    rateLimited: preset === 'rateLimited',
    failSignature: false,
    failCleanup: false,
    hold: false,
    token: 0,
  };
  const candidate = () => ({ version: '0.2.0-beta.10', notes: '修复网络连接与更新体验。' });
  if (!['idle', 'unsupported'].includes(preset)) status.lastChecked = Math.floor(Date.now() / 1000);
  if (
    [
      'available',
      'downloading',
      'indeterminate',
      'signature',
      'ready',
      'portable',
      'installing',
    ].includes(preset)
  )
    status.candidate = candidate();
  if (preset === 'failed' || preset === 'rateLimited')
    status.error = preset === 'failed' ? 'network' : 'rateLimited';
  if (preset === 'rateLimited') status.retryAt = Math.floor(Date.now() / 1000) + 120;
  if (preset === 'signature') status.error = 'signature';
  if (['available', 'signature', 'portable'].includes(preset)) status.phase = 'available';
  else if (['checking', 'current', 'ready', 'installing'].includes(preset))
    status.phase = preset as UpdateSnapshot['phase'];
  else if (preset === 'downloading' || preset === 'indeterminate') {
    status.phase = 'downloading';
    status.downloaded = 42;
    status.total = preset === 'indeterminate' ? null : 100;
  }
  const pause = () => new Promise<void>((resolve) => setTimeout(resolve, 80));
  const adapter: UpdateAdapter = {
    read: async () => structuredClone(status),
    watch: async (receive) => {
      listeners.add(receive);
      return () => {
        listeners.delete(receive);
      };
    },
    command: async (command) => {
      if (disposed) throw 'cancelled';
      if (command.action === 'check') {
        status.phase = 'checking';
        status.error = null;
        emit();
        const token = ++control.token;
        await pause();
        if (disposed || token !== control.token) throw 'cancelled';
        status.lastChecked = Math.floor(Date.now() / 1000);
        status.phase = status.candidate ? 'available' : 'idle';
        if (control.rateLimited) {
          status.error = 'rateLimited';
          status.retryAt = status.lastChecked + 120;
          emit();
          throw 'rateLimited';
        }
        if (control.failCheck) {
          status.error = 'network';
          emit();
          throw 'network';
        }
        status.error = null;
        status.retryAt = null;
        status.candidate = candidate();
        status.phase = 'available';
      } else if (command.action === 'configure') {
        status.preferences = structuredClone(command.preferences);
      } else if (command.action === 'cancel') {
        control.token++;
        status.phase = status.candidate ? 'available' : 'idle';
        status.error = null;
      } else if (command.action === 'openZip' || command.action === 'openRelease') {
        control.opens.push(command.action);
      } else if (command.action === 'update') {
        if (status.distribution !== 'installed') throw 'portable';
        if (!command.confirmed) {
          const token = ++control.token;
          control.downloads++;
          status.phase = 'downloading';
          status.downloaded = 40;
          status.total = 100;
          status.error = null;
          emit();
          while (control.hold && token === control.token && !disposed) await pause();
          // Held downloads are controlled by tests; ordinary downloads advance.
          while (!disposed && token === control.token && status.downloaded < 100) {
            await pause();
            if (control.hold) continue;
            status.downloaded = Math.min(100, status.downloaded + 8);
            emit();
          }
          if (disposed || token !== control.token) throw 'cancelled';
          if (control.failSignature) {
            status.error = 'signature';
            status.phase = 'available';
            emit();
            throw 'signature';
          }
          status.phase = 'ready';
        } else {
          if (control.failCleanup) {
            status.error = 'cleanup';
            emit();
            throw 'cleanup';
          }
          control.installs++;
          status.phase = 'installing';
        }
      }
      emit();
      return structuredClone(status);
    },
  };
  return {
    adapter,
    control,
    dispose: () => {
      disposed = true;
      control.token++;
      listeners.clear();
    },
  };
}
