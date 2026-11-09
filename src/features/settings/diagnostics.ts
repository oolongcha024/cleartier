import type { DiagnosticReport } from '../../platform/desktop.ts';

type CheckStatus = 'ok' | 'error' | 'pending' | 'unknown' | 'inactive';
type CheckId = 'config' | 'core' | 'networks' | 'tun' | 'logs';
export interface DiagnosticCheck {
  id: CheckId;
  status: CheckStatus;
}

// Interpret only local facts. Historical errors and running processes do not
// establish current peer reachability.
export function summarizeDiagnostics(report: DiagnosticReport) {
  const running = report.networks.filter((network) => network.state === 'running');
  const transitioning = report.networks.some((network) =>
    ['starting', 'stopping'].includes(network.state),
  );
  const checks: DiagnosticCheck[] = [
    {
      id: 'config',
      status: report.configurationReadable && report.preferencesReadable ? 'ok' : 'error',
    },
    {
      id: 'core',
      status:
        report.coreState === 'starting'
          ? 'pending'
          : report.coreState === 'failed' || report.coreError
            ? 'error'
            : report.snapshotError
              ? 'unknown'
              : report.coreState === 'stopped'
                ? 'inactive'
                : 'ok',
    },
    {
      id: 'networks',
      status: report.snapshotError
        ? 'unknown'
        : report.networks.some(
              (network) =>
                !['starting', 'stopping'].includes(network.state) &&
                (network.state === 'failed' || network.error),
            )
          ? 'error'
          : transitioning
            ? 'pending'
            : report.networks.some((network) => !['running', 'stopped'].includes(network.state))
              ? 'unknown'
              : running.length
                ? 'ok'
                : 'inactive',
    },
    {
      id: 'tun',
      status: report.snapshotError
        ? 'unknown'
        : running.some(
              (network) => network.interfaceExpected === true && network.interfacePresent === false,
            )
          ? 'error'
          : running.some(
                (network) =>
                  network.interfaceExpected === null ||
                  (network.interfaceExpected === true && network.interfacePresent === null),
              )
            ? 'unknown'
            : running.some((network) => network.interfaceExpected === true)
              ? 'ok'
              : 'inactive',
    },
    { id: 'logs', status: report.processLogsReadable ? 'ok' : 'unknown' },
  ];
  const problems = checks.filter((check) => check.status === 'error' || check.status === 'unknown');
  const errorCount = checks.filter((check) => check.status === 'error').length;
  const summary: 'issues' | 'incomplete' | 'pending' | 'healthy' | 'idle' = errorCount
    ? 'issues'
    : problems.length
      ? 'incomplete'
      : checks.some((check) => check.status === 'pending')
        ? 'pending'
        : running.length
          ? 'healthy'
          : 'idle';
  return { checks, problems, errorCount, summary };
}
