import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, useSnackbar } from '../../components/ui';
import type { Network } from './model';
import { useNetworkStore } from './store';

export function useNetworkDeletion() {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const remove = useNetworkStore((state) => state.removeNetwork);
  const [target, setTarget] = useState<Network | null>(null);
  const [removing, setRemoving] = useState(false);
  const [failed, setFailed] = useState(false);
  const confirm = async () => {
    if (!target || removing) return;
    setRemoving(true); setFailed(false);
    const saved = await remove(target.id);
    setRemoving(false);
    if (saved) { setTarget(null); notify(t('networkConfig.deleted')); }
    else setFailed(true);
  };
  const deletion = <Dialog open={Boolean(target)} onOpenChange={(open) => { if (!open && !removing) setTarget(null); }}
    title={t('networkConfig.deleteTitle')} description={t('networkConfig.deleteDescription', { alias: target?.alias, name: target?.savedConfig.name })}>
    {failed && <p className="configuration-error-text" role="alert">{t('configuration.deleteFailed')}</p>}
    <div className="network-editor-actions"><Button variant="text" disabled={removing} onClick={() => setTarget(null)}>{t('networkConfig.cancel')}</Button>
      <Button disabled={removing} onClick={() => { void confirm(); }}>{t(removing ? 'networkConfig.deleting' : 'networkConfig.delete')}</Button></div>
  </Dialog>;
  return { requestDelete: (network: Network) => { setFailed(false); setTarget(network); }, deletion };
}
