import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Icon } from '../../components/ui';
import { isBusy, isConnected, statusKey } from './model';
import { NetworkStatus } from './NetworkStatus';
import { useNetworkStore } from './store';

export function NetworksPage() {
  const { t } = useTranslation();
  const { networks, toggleConnection } = useNetworkStore();
  const connectedCount = networks.filter(isConnected).length;

  return <div className="networks-page">
    <div className="networks-page-summary">
      <span>{t('dashboard.networkCount', { count: networks.length })}</span>
      <Chip dot tone={connectedCount ? 'success' : 'neutral'}>
        {t(connectedCount ? 'dashboard.networksOnline' : 'dashboard.allOffline', { count: connectedCount })}
      </Chip>
    </div>
    <Card className="network-config-card"><ul className="network-config-list">
      {networks.map((network) => {
        const running = network.coreState !== 'stopped';
        const busy = isBusy(network);
        return <li key={network.id} className="network-config-row">
          <div className="network-config-identity">
            <span className="network-avatar"><Icon name={network.icon} /></span>
            <div className="network-identity"><h2 title={network.alias}>{network.alias}</h2><span title={network.name}>{network.name}</span></div>
          </div>
          <div className="network-config-actions"><NetworkStatus network={network} />
            <Button variant={running ? 'outlined' : 'filled'} icon={busy ? undefined : 'power_settings_new'} disabled={busy}
              aria-label={t(running ? 'dashboard.disconnectNamed' : 'dashboard.connectNamed', { name: network.alias })}
              onClick={() => { void toggleConnection(network.id); }}>
              {t(`dashboard.${busy ? statusKey(network) : running ? 'disconnect' : 'connect'}`)}
            </Button>
          </div>
        </li>;
      })}
    </ul></Card>
  </div>;
}
