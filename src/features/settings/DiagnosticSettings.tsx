import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, useSnackbar } from '../../components/ui';
import { isDesktop } from '../../platform/client';
import { exportDiagnostics, openLogs, readDiagnostics, type DiagnosticReport } from '../../platform/desktop';

export function DiagnosticSettings() {
  const { t, i18n } = useTranslation();
  const formatTime = new Intl.DateTimeFormat(i18n.resolvedLanguage ?? i18n.language, { dateStyle: 'short', timeStyle: 'medium' });
  const notify = useSnackbar();
  const [report, setReport] = useState<DiagnosticReport | null>(null);
  const [busy, setBusy] = useState<'read' | 'export' | 'logs' | null>(null);
  const [failed, setFailed] = useState(false);
  const tunNetworks = report?.networks.filter((network) => network.state === 'running' && network.interfaceExpected === true) ?? [];
  useEffect(() => {
    if (!isDesktop()) return;
    let disposed = false;
    void readDiagnostics().then((report) => { if (!disposed) setReport(report); })
      .catch(() => { if (!disposed) setFailed(true); });
    return () => { disposed = true; };
  }, []);
  const run = async (action: 'read' | 'export' | 'logs') => {
    if (busy) return;
    if (!isDesktop()) { notify(t('desktop.diagnosticsDesktopOnly')); return; }
    setBusy(action); setFailed(false); notify('');
    try {
      if (action === 'read') setReport(await readDiagnostics());
      else if (action === 'export') { if (await exportDiagnostics()) notify(t('desktop.exported')); }
      else await openLogs();
    } catch { setFailed(true); }
    finally { setBusy(null); }
  };
  return <section className="card settings-card">
    <div className="settings-section-heading"><h2>{t('desktop.diagnostics')}</h2>
      {isDesktop() && <Button variant="text" disabled={Boolean(busy)} icon="refresh" onClick={() => { void run('read'); }}>{t('connection.refresh')}</Button>}
    </div>
    {failed && <p className="settings-notice" role="alert">{t('desktop.diagnosticsFailed')}</p>}
    {report && !report.processLogsReadable && <p className="settings-notice" role="status">{t('desktop.logsIncomplete')}</p>}
    {report && <div className="diagnostic-checks">
      <DiagnosticCheck label={t('desktop.configCheck')} ok={report.configurationReadable && report.preferencesReadable} />
      <DiagnosticCheck label={t('desktop.coreCheck')} ok={!report.snapshotError && !report.coreError}
        value={t(`desktop.coreStates.${report.snapshotError ? 'unavailable' : report.coreState}`)} />
      {report.networks.length > 0 && <DiagnosticCheck label={t('desktop.networkCheck')}
        ok={report.networks.every((network) => network.state === 'stopped' || (network.state === 'running' && !network.error))}
        value={t('desktop.networkSummary', { running: report.networks.filter((network) => network.state === 'running').length, count: report.networks.length })} />}
      {tunNetworks.length > 0 && <DiagnosticCheck label={t('desktop.tunCheck')}
        ok={tunNetworks.every((network) => network.interfacePresent === true)} />}
    </div>}
    <div className="settings-actions">
      <Button variant="outlined" icon="folder_open" disabled={Boolean(busy)} onClick={() => { void run('logs'); }}>{t('desktop.openLogs')}</Button>
      <Button variant="tonal" icon="download" disabled={Boolean(busy)} onClick={() => { void run('export'); }}>{t(busy === 'export' ? 'desktop.exporting' : 'desktop.exportDiagnostics')}</Button>
    </div>
    <p className="settings-footnote">{t('desktop.diagnosticsPrivacy')}</p>
    {report && <div className="diagnostic-errors"><h3>{t('desktop.recentErrors')}</h3>
      {report.recentErrors.length ? <ul>{report.recentErrors.slice(-5).reverse().map((error, index) => <li key={`${error.time}-${index}`}>
        <time dateTime={new Date(error.time * 1000).toISOString()}>{formatTime.format(error.time * 1000)}</time>
        <span>{t(`connection.errors.${error.code}`, { defaultValue: t('connection.errors.operation_failed') })}</span>
      </li>)}</ul> : <p className="muted">{t('desktop.noRecentErrors')}</p>}
    </div>}
  </section>;
}
function DiagnosticCheck({ label, ok, value }: { label: string; ok: boolean; value?: string }) {
  const { t } = useTranslation();
  return <div className={`diagnostic-check ${ok ? '' : 'diagnostic-check--error'}`}><Icon name={ok ? 'check_circle' : 'error'} /><span>{label}</span>
    <span className="muted">{value ?? t(ok ? 'desktop.checkPassed' : 'desktop.checkFailed')}</span></div>;
}
