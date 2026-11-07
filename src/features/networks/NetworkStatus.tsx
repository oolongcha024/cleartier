import { useTranslation } from 'react-i18next';
import { Chip } from '../../components/ui';
import { isBusy, isConnected, statusKey, type Network } from './model';

export function NetworkStatus({ network }: { network: Network }) {
  const { t } = useTranslation();
  return <Chip tone={isConnected(network) ? 'success' : isBusy(network) ? 'primary' : 'neutral'} dot>
    {t(`dashboard.${statusKey(network)}`)}
  </Chip>;
}
