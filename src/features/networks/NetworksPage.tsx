import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Icon, IconButton } from '../../components/ui';
import { hasPendingConfig, serverSummary } from './configuration';
import { isBusy } from './model';
import { useNetworkEditor } from './use-network-editor';
import { useNetworkStore } from './store';
import { ConfigurationState } from './ConfigurationState';
import { useNetworkDeletion } from './use-network-deletion';

export function NetworksPage() {
  const { t } = useTranslation();
  const networks = useNetworkStore((state) => state.networks);
  const { openEditor, openCreator, editor } = useNetworkEditor();
  const phase = useNetworkStore((state) => state.phase);
  const writing = useNetworkStore((state) => state.writing);
  const { requestDelete, deletion } = useNetworkDeletion();
  if (phase !== 'ready' || !networks.length) return <><ConfigurationState onAdd={openCreator} />{editor}</>;

  return <div className="networks-page">
    <div className="networks-page-summary"><span>{t('networkConfig.savedCount', { count: networks.length })}</span>
      <Button variant="tonal" icon="add" onClick={openCreator}>{t('dashboard.join')}</Button></div>
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
              onClick={() => openEditor(network.id)}>
              {t(isBusy(network) ? 'networkConfig.busyShort' : 'networkConfig.edit')}
            </Button>
            <IconButton icon="delete" label={t('networkConfig.deleteNamed', { name: network.alias })}
              disabled={writing || !['stopped', 'failed'].includes(network.coreState) || network.runningConfig !== null} onClick={() => requestDelete(network)} />
          </div>
        </li>;
      })}
    </ul></Card>
    {editor}
    {deletion}
  </div>;
}
