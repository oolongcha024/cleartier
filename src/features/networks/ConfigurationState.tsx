import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Dialog, Icon } from '../../components/ui';
import { useNetworkStore } from './store';

export function ConfigurationState({ onAdd, onImport, importing = false }: { onAdd: () => void; onImport?: () => void; importing?: boolean }) {
  const { t } = useTranslation();
  const phase = useNetworkStore((state) => state.phase);
  const error = useNetworkStore((state) => state.storageError);
  const initialize = useNetworkStore((state) => state.initialize);
  const [restoreConfirm, setRestoreConfirm] = useState(false);
  const failed = phase === 'error';
  return <>
    <Card className="configuration-state" aria-busy={phase === 'loading'}>
      <Icon name={phase === 'loading' ? 'folder_open' : failed ? 'error_outline' : 'hub'} />
      <h2>{t(phase === 'loading' ? 'configuration.loading' : failed ? 'configuration.loadFailed' : 'configuration.empty')}</h2>
      {phase === 'ready' && <div className="configuration-state-actions">
        {onImport && <Button variant="outlined" icon="file_open" disabled={importing} onClick={onImport}>{t('toml.import')}</Button>}
        <Button icon="add" onClick={onAdd}>{t('dashboard.join')}</Button>
      </div>}
      {failed && <>
        <p role="alert">{t(`configuration.errors.${error?.code}`, { defaultValue: t('configuration.errors.io') })}</p>
        <div className="configuration-state-actions"><Button variant="outlined" onClick={() => { void initialize(); }}>{t('configuration.retry')}</Button>
          {error?.backupAvailable && <Button onClick={() => setRestoreConfirm(true)}>{t('configuration.restore')}</Button>}
        </div>
      </>}
    </Card>
    <Dialog open={restoreConfirm} onOpenChange={setRestoreConfirm} title={t('configuration.restoreTitle')} description={t('configuration.restoreDescription')}>
      <div className="network-editor-actions"><Button variant="text" onClick={() => setRestoreConfirm(false)}>{t('networkConfig.cancel')}</Button>
        <Button onClick={() => { setRestoreConfirm(false); void initialize(true); }}>{t('configuration.restore')}</Button></div>
    </Dialog>
  </>;
}

export function ConfigurationNotice() {
  const { t } = useTranslation();
  const phase = useNetworkStore((state) => state.phase);
  const error = useNetworkStore((state) => state.storageError);
  const initialize = useNetworkStore((state) => state.initialize);
  const clear = useNetworkStore((state) => state.clearStorageError);
  if (phase !== 'ready' || !error) return null;
  return <div className="configuration-notice" role="alert"><Icon name="error_outline" />
    <span>{t(`configuration.errors.${error.code}`, { defaultValue: t('configuration.errors.io') })}</span>
    {error.code === 'conflict' && <Button variant="text" onClick={() => { void initialize(); }}>{t('configuration.reload')}</Button>}
    <Button variant="text" onClick={clear}>{t('app.close')}</Button>
  </div>;
}
