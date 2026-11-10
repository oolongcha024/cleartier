import { useEffect, useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Collapsible } from '@base-ui/react/collapsible';
import { useTranslation } from 'react-i18next';
import { Button, Icon, useSnackbar } from '../../components/ui';
import {
  exportDiagnostics,
  openLogs,
  readDiagnostics,
  type DiagnosticReport,
} from '../../platform/desktop';
import { summarizeDiagnostics, type DiagnosticCheck } from './diagnostics';

const checkIcons = {
  ok: 'check_circle',
  error: 'error',
  pending: 'progress_activity',
  unknown: 'help',
  inactive: 'remove_circle_outline',
};
const summaryIcons = {
  healthy: 'check_circle',
  issues: 'error',
  incomplete: 'help',
  idle: 'info',
  pending: 'progress_activity',
  checking: 'progress_activity',
  failed: 'error',
};
type Action = 'read' | 'export' | 'logs';

export function DiagnosticSettings() {
  const { t, i18n } = useTranslation();
  const formatTime = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, {
    dateStyle: 'short',
    timeStyle: 'medium',
  });
  const notify = useSnackbar();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [busy, setBusy] = useState<Action | null>('read');
  const [readFailed, setReadFailed] = useState(false);
  const [actionError, setActionError] = useState<'export' | 'logs' | null>(null);
  const result = report ? summarizeDiagnostics(report) : null;
  const summary =
    busy === 'read' ? 'checking' : readFailed ? 'failed' : (result?.summary ?? 'checking');
  const disabled = Boolean(busy);
  const checks: DiagnosticCheck[] =
    result?.checks ??
    (['config', 'core', 'networks', 'tun', 'logs'] as const).map((id) => ({
      id,
      status: 'unknown',
    }));

  useEffect(() => {
    let disposed = false;
    void readDiagnostics()
      .then((next) => {
        if (!disposed) setReport(next);
      })
      .catch(() => {
        if (!disposed) setReadFailed(true);
      })
      .finally(() => {
        if (!disposed) setBusy(null);
      });
    return () => {
      disposed = true;
    };
  }, []);

  const run = async (action: Action) => {
    if (busy) return;
    setBusy(action);
    setActionError(null);
    if (action === 'read') setReadFailed(false);
    notify('');
    try {
      if (action === 'read') setReport(await readDiagnostics());
      else if (action === 'export') {
        if (await exportDiagnostics()) notify(t('desktop.exported'));
      } else await openLogs();
    } catch {
      if (action === 'read') setReadFailed(true);
      else setActionError(action);
    } finally {
      setBusy(null);
    }
  };

  const checkValue = (check: DiagnosticCheck) => {
    if (!report) return t('desktop.diagnosticStates.unchecked');
    if (check.id === 'core' && ['ok', 'inactive', 'pending'].includes(check.status))
      return t(`desktop.coreStates.${report.coreState}`);
    if (check.id === 'networks' && check.status === 'ok')
      return t('desktop.networkSummary', {
        running: report.networks.filter((network) => network.state === 'running').length,
        count: report.networks.length,
      });
    if (check.id === 'networks' && check.status === 'inactive')
      return t('desktop.diagnosticStates.noNetworks');
    return t(`desktop.diagnosticStates.${check.status}`);
  };
  const problemAdvice = (check: DiagnosticCheck) => {
    const fallback = t(`desktop.diagnosticAdvice.${check.id}.${check.status}`);
    const code =
      check.status === 'error'
        ? check.id === 'core'
          ? report?.coreError
          : check.id === 'networks'
            ? report?.networks.find((network) => network.error)?.error
            : null
        : null;
    return code ? t(`connection.errors.${code}`, { defaultValue: fallback }) : fallback;
  };

  return (
    <section className="card settings-card diagnostic-card">
      <div className="settings-section-heading">
        <h2>{t('desktop.diagnostics')}</h2>
        <Button variant="text" disabled={disabled} icon="refresh" onClick={() => void run('read')}>
          {t('desktop.recheck')}
        </Button>
      </div>
      <div
        className="diagnostic-summary"
        data-state={summary}
        role="status"
        aria-live="polite"
        aria-atomic="true"
      >
        <span className="diagnostic-summary-mark">
          <Icon
            name={summaryIcons[summary]}
            className={summary === 'checking' || summary === 'pending' ? 'is-spinning' : ''}
          />
        </span>
        <div>
          <p className="diagnostic-summary-title">
            {t(`desktop.diagnosticSummary.${summary}`, { count: result?.errorCount ?? 0 })}
          </p>
          {report && (
            <p className="diagnostic-timestamp">
              {t('desktop.checkedAt', { time: formatTime.format(report.generatedAt * 1000) })}
            </p>
          )}
        </div>
      </div>
      {readFailed && (
        <p className="settings-notice" role="alert">
          {t(report ? 'desktop.recheckFailed' : 'desktop.initialCheckFailed')}
        </p>
      )}
      {result && busy !== 'read' && !readFailed && result.problems.length > 0 && (
        <ul className="diagnostic-problems">
          {result.problems.map((check) => (
            <li key={check.id} data-state={check.status}>
              <Icon name={checkIcons[check.status]} />
              <div>
                <p className="diagnostic-problem-title">
                  {t(`desktop.diagnosticLabels.${check.id}`)}
                </p>
                <p>{problemAdvice(check)}</p>
              </div>
            </li>
          ))}
          {result.problems.some((check) => ['core', 'networks', 'tun'].includes(check.id)) && (
            <li className="diagnostic-problem-action">
              <Link to="/networks" className="button button--text">
                {t('desktop.viewNetworks')}
                <Icon name="arrow_forward" />
              </Link>
            </li>
          )}
        </ul>
      )}
      <DiagnosticDisclosure icon="fact_check" label={t('desktop.checkDetails')}>
        <div className="diagnostic-checks">
          {checks.map((check) => (
            <div className="diagnostic-check" key={check.id} data-state={check.status}>
              <Icon
                name={report ? checkIcons[check.status] : 'remove_circle_outline'}
                className={check.status === 'pending' ? 'is-spinning' : ''}
              />
              <span>{t(`desktop.diagnosticLabels.${check.id}`)}</span>
              <span>{checkValue(check)}</span>
            </div>
          ))}
        </div>
        <Button
          variant="text"
          icon="folder_open"
          disabled={disabled}
          onClick={() => void run('logs')}
        >
          {t(busy === 'logs' ? 'desktop.openingLogs' : 'desktop.openLogs')}
        </Button>
      </DiagnosticDisclosure>
      {report && report.recentErrors.length > 0 && (
        <DiagnosticDisclosure
          icon="history"
          label={t('desktop.diagnosticHistory', { count: report.recentErrors.length })}
        >
          <ul className="diagnostic-history">
            {report.recentErrors
              .slice()
              .reverse()
              .map((error, index) => (
                <li key={`${error.time}-${index}`}>
                  <time dateTime={new Date(error.time * 1000).toISOString()}>
                    {formatTime.format(error.time * 1000)}
                  </time>
                  <span>
                    {t(`connection.errors.${error.code}`, {
                      defaultValue: t('connection.errors.operation_failed'),
                    })}
                  </span>
                </li>
              ))}
          </ul>
        </DiagnosticDisclosure>
      )}
      {actionError && (
        <p className="settings-notice" role="alert">
          {t(`desktop.diagnosticActionErrors.${actionError}`)}
        </p>
      )}
      <div className="settings-actions diagnostic-footer">
        <p className="settings-footnote diagnostic-privacy">
          <Icon name="verified_user" />
          <span>{t('desktop.diagnosticsPrivacy')}</span>
        </p>
        <Button
          variant="tonal"
          icon="download"
          disabled={disabled}
          onClick={() => void run('export')}
        >
          {t(busy === 'export' ? 'desktop.exporting' : 'desktop.exportDiagnostics')}
        </Button>
      </div>
    </section>
  );
}

function DiagnosticDisclosure({
  icon,
  label,
  children,
}: {
  icon: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <Collapsible.Root className="diagnostic-disclosure">
      <Collapsible.Trigger className="diagnostic-disclosure-trigger">
        <Icon name={icon} />
        <span>{label}</span>
        <Icon name="expand_more" className="diagnostic-disclosure-chevron" />
      </Collapsible.Trigger>
      <Collapsible.Panel className="diagnostic-disclosure-panel">
        <div className="diagnostic-disclosure-content">{children}</div>
      </Collapsible.Panel>
    </Collapsible.Root>
  );
}
