import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Icon } from '../../components/ui';
import { respondDesktop } from '../../platform/desktop';
import { subscribeDesktop, useDesktopStore } from './desktop-store';

export function DesktopLifecycle() {
  const { t } = useTranslation();
  const status = useDesktopStore((state) => state.status);
  const refresh = useDesktopStore((state) => state.refresh);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);
  useEffect(subscribeDesktop, []);
  const request = status?.pending;
  useEffect(() => { setError(false); }, [request?.id]);
  const respond = async (choice: 'cancel' | 'background' | 'exit') => {
    if (!request || busy) return;
    setBusy(true); setError(false);
    try { await respondDesktop(request.id, choice); await refresh(); }
    catch { setError(true); }
    finally { setBusy(false); }
  };
  const closing = request?.kind === 'close';
  return <>
    {status?.exitError && <div className="configuration-notice" role="alert"><Icon name="error" />
      <span>{t('desktop.shutdownFailed')}</span></div>}
    <Dialog open={Boolean(request)} onOpenChange={(open) => { if (!open) void respond('cancel'); }}
      className="desktop-dialog" title={t(closing ? 'desktop.closeTitle' : 'desktop.exitTitle')}
      description={t(closing ? 'desktop.closeDescription' : 'desktop.exitDescription')}>
      {error && <p className="desktop-error" role="alert">{t('desktop.actionFailed')}</p>}
      <div className="desktop-dialog-actions">
        <Button variant="text" disabled={busy} onClick={() => { void respond(closing ? 'exit' : 'cancel'); }}>
          {t(closing ? 'desktop.exit' : 'networkConfig.cancel')}
        </Button>
        <Button disabled={busy} onClick={() => { void respond(closing ? 'background' : 'exit'); }}>
          {t(busy ? 'desktop.processing' : closing ? 'desktop.runInBackground' : 'desktop.confirmExit')}
        </Button>
      </div>
    </Dialog>
    {status?.quitting && <div className="desktop-exit-status" role="status"><Icon name="progress_activity" className="is-spinning" />{t('desktop.quitting')}</div>}
  </>;
}
