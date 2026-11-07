import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Icon } from '../../components/ui';
import { hasPendingConfig, serverSummary } from './configuration';
import { isBusy } from './model';
import { NetworkEditor } from './NetworkEditor';
import { useNetworkStore } from './store';

export function NetworksPage() {
  const { t } = useTranslation();
  const networks = useNetworkStore((state) => state.networks);
  const [editor, setEditor] = useState({ id: '', open: false, session: 0 });
  const editingNetwork = networks.find((network) => network.id === editor.id);

  return <div className="networks-page">
    <div className="networks-page-summary"><span>{t('networkConfig.savedCount', { count: networks.length })}</span></div>
    <Card className="network-config-card"><ul className="network-config-list">
      {networks.map((network) => {
        const summary = network.savedConfig.servers.map(serverSummary).join(' · ');
        return <li key={network.id} className="network-config-row">
          <div className="network-config-identity">
            <span className="network-avatar"><Icon name={network.icon} /></span>
            <div className="network-identity"><h2 title={network.alias}>{network.alias}</h2>
              <span title={network.savedConfig.name}>{network.savedConfig.name}</span>
              <span className="network-server-summary" title={summary}>{serverSummary(network.savedConfig.servers[0])}
                {network.savedConfig.servers.length > 1 && <span> +{network.savedConfig.servers.length - 1}</span>}
              </span>
            </div>
          </div>
          <div className="network-config-actions">
            {hasPendingConfig(network) && !isBusy(network) && <Chip tone="primary">{t('networkConfig.pending')}</Chip>}
            <Button variant="text" icon="edit" disabled={isBusy(network)} aria-label={t('networkConfig.editNamed', { name: network.alias })}
              onClick={() => setEditor((current) => ({ id: network.id, open: true, session: current.session + 1 }))}>
              {t(isBusy(network) ? 'networkConfig.busyShort' : 'networkConfig.edit')}
            </Button>
          </div>
        </li>;
      })}
    </ul></Card>
    {editingNetwork && <NetworkEditor key={editor.session} network={editingNetwork} open={editor.open}
      onOpenChange={(open) => setEditor((current) => ({ ...current, open }))} />}
  </div>;
}
