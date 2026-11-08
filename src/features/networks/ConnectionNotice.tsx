import { useTranslation } from 'react-i18next';
import { Button, Icon } from '../../components/ui';
import { useNetworkStore } from './store';

export function ConnectionNotice() {
  const { t } = useTranslation();
  const cancelled = useNetworkStore((state) => state.autoConnectCancelled);
  const dismiss = useNetworkStore((state) => state.dismissAutoConnectNotice);
  if (!cancelled) return null;
  return (
    <div className="configuration-notice" role="status">
      <Icon name="info" />
      <span>{t('connection.autoCancelled')}</span>
      <Button variant="text" onClick={dismiss}>
        {t('app.close')}
      </Button>
    </div>
  );
}
