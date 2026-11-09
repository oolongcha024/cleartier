import { useTranslation } from 'react-i18next';
import { Card } from '../../components/ui';
import type { Network } from '../networks/model';
import { PeerTable } from './PeerTable';
import { useNetworkDevices } from '../networks/store';

export function DevicesCard({
  network,
  onCopy,
}: {
  network: Network;
  onCopy: (value: string) => void;
}) {
  const { t } = useTranslation();
  const telemetry = useNetworkDevices(network.id);
  const stale = telemetry.freshness === 'stale' || network.coreState === 'unknown';
  const peers =
    network.coreState === 'running' || network.coreState === 'unknown' ? telemetry.peers : [];
  return (
    <Card className="devices-card">
      <div className="card-heading">
        <h2>
          {t('dashboard.devicesTitle')}
          <span className="heading-count">{peers.length}</span>
        </h2>
        {stale && (
          <span className="data-status" role="status">
            {t('dashboard.dataStale')}
          </span>
        )}
      </div>
      <PeerTable
        key={network.id}
        networkId={network.id}
        preferences={network.peerIcons}
        peers={peers}
        onCopy={onCopy}
        stale={stale}
      />
    </Card>
  );
}
