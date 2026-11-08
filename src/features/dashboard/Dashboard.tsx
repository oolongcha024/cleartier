import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Dialog, Hint, Icon, IconButton, Select, Switch, useSnackbar } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { activeVirtualIp, isBusy, isConnected, statusKey, summaryKey, type Network } from '../networks/model';
import { useNetworkStore, useNodeHostname } from '../networks/store';
import { NetworkStatus } from '../networks/NetworkStatus';
import { useNetworkEditor } from '../networks/use-network-editor';
import { hasPendingConfig } from '../networks/configuration';
import { DevicesCard } from './DevicesCard';
import { TrafficCard } from './TrafficCard';
import { ConfigurationState } from '../networks/ConfigurationState';

function ConnectionCard({ network, onCopy }: { network: Network; onCopy: (value: string) => void }) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const toggleConnection = useNetworkStore((state) => state.toggleConnection);
  const setAutoConnect = useNetworkStore((state) => state.setAutoConnect);
  const connectionEnabled = useNetworkStore((state) => state.connectionEnabled);
  const writing = useNetworkStore((state) => state.writing);
  const refresh = useNetworkStore((state) => state.refreshRuntime);
  const autoConnecting = useNetworkStore((state) => state.autoConnecting);
  const hostname = useNodeHostname(network.id) ?? (network.peerCount === undefined ? network.runningConfig?.hostname || 'ClearTier-PC' : '');
  const connected = isConnected(network);
  const busy = isBusy(network);
  const running = network.coreState === 'running' || (network.coreState === 'failed' && network.runningConfig !== null);
  const name = (network.runningConfig ?? network.savedConfig).name;
  const title = network.coreState === 'failed' ? 'failed' : network.coreState === 'unknown' ? 'unavailable' : network.coreState === 'stopped' ? 'disconnected'
    : network.coreState === 'starting' ? 'starting'
      : network.coreState === 'stopping' ? 'stopping' : connected ? 'connected' : 'waiting';
  const detail = network.coreState === 'failed' ? t('connection.failedHint') : network.coreState === 'unknown' ? t('dashboard.unavailableHint') : network.coreState === 'stopped' ? t('dashboard.offlineHint')
    : network.coreState === 'starting' ? t('dashboard.startingHint')
      : network.coreState === 'stopping' ? t('dashboard.stoppingHint')
        : connected ? t('dashboard.peers', { count: network.peerCount ?? network.peers.length, direct: network.directPeerCount ?? network.peers.filter((peer) => peer.connection === 'direct').length })
          : t('dashboard.waitingHint');

  return <Card className={`connection-card ${connected ? 'connection-card--connected' : ''}`}>
    <div className="network-heading"><div className={`network-avatar network-avatar--${network.icon}`}><Icon name={network.icon} /></div>
      <div className="network-identity"><h2 title={network.alias}>{network.alias}</h2><span title={name}>{name}</span></div>
      <div className="network-heading-status"><NetworkStatus network={network} />
        {hasPendingConfig(network) && !busy && <Chip tone="primary">{t('networkConfig.pending')}</Chip>}
      </div>
    </div>
    <div className="connection-state">
      <div className={`connection-state-icon ${connected ? 'connection-state-icon--connected' : ''} ${busy ? 'is-spinning' : ''}`}>
        <Icon name={busy ? 'progress_activity' : connected ? 'check' : 'power_settings_new'} />
      </div>
      <div className="connection-state-text" aria-live="polite"><h3>{t(`dashboard.${title}`)}</h3><p>{detail}</p></div>
      <Button variant={running ? 'outlined' : 'filled'} icon={busy ? undefined : network.coreState === 'unknown' ? 'refresh' : 'power_settings_new'} disabled={busy || !connectionEnabled || (autoConnecting && !running)}
        onClick={() => { void (network.coreState === 'unknown' ? refresh() : toggleConnection(network.id)); }}>
        {t(network.coreState === 'unknown' ? 'connection.refresh' : `dashboard.${busy ? statusKey(network) : running ? 'disconnect' : 'connect'}`)}
      </Button>
    </div>
    {network.connectionError && <p role="alert" className="connection-error">{t(`connection.errors.${network.connectionError.code}`, { defaultValue: t('connection.errors.operation_failed') })}</p>}
    <div className="connection-facts">
      <div className="connection-fact"><span className="fact-label">{t('dashboard.virtualIp')}</span>
        <div className="fact-value ip-value"><span className="selectable-ip">{running ? activeVirtualIp(network) || '—' : '—'}</span>
          {running && activeVirtualIp(network) && <IconButton icon="content_copy" label={t('dashboard.copyIp')} onClick={() => onCopy(activeVirtualIp(network))} />}
        </div>
      </div>
      <div className="connection-fact"><span className="fact-label">{t('networkConfig.hostname')}</span>
        <div className="fact-value node-hostname" title={running ? hostname : undefined}>{running ? hostname || '—' : '—'}</div>
      </div>
      <div className="connection-fact"><span className="fact-label">{t('dashboard.autoConnect')}</span>
        <div className="fact-value"><Switch checked={network.autoConnect} disabled={writing} label={t('dashboard.autoConnectLabel', { name: network.alias })}
          onChange={(enabled) => {
            void setAutoConnect(network.id, enabled).then((saved) => {
              if (saved) notify(t(connectionEnabled ? enabled ? 'feedback.autoOn' : 'feedback.autoOff' : 'configuration.autoConnectSaved', { name: network.alias }));
            });
          }} /></div>
      </div>
    </div>
  </Card>;
}

function QuickActions({ network, onCopy, onEdit }: {
  network: Network; onCopy: (value: string) => void; onEdit: () => void;
}) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const reconnect = useNetworkStore((state) => state.reconnect);
  const connectionEnabled = useNetworkStore((state) => state.connectionEnabled);
  const pending = hasPendingConfig(network);
  const busy = isBusy(network);
  const handleReconnect = async () => {
    const restarting = reconnect(network.id);
    notify(t(pending ? 'feedback.reconnectingApply' : 'feedback.reconnecting', { name: network.alias }));
    notify(t(await restarting ? 'feedback.reconnected' : 'networkConfig.applyFailed', { name: network.alias }));
  };
  return <Card className="quick-card"><h2>{t('dashboard.quickActions')}</h2>
    <div className="quick-actions">
      <Hint label={t('dashboard.soon')}><button className="quick-action" disabled>
        <span className="quick-icon"><Icon name="person_add" /></span><span>{t('dashboard.invite')}</span>
      </button></Hint>
      <button className="quick-action" disabled={network.coreState !== 'running' || !activeVirtualIp(network)} onClick={() => onCopy(activeVirtualIp(network))}>
        <span className="quick-icon"><Icon name="content_copy" /></span><span>{t('dashboard.copyIp')}</span>
      </button>
      <Hint label={t(pending ? 'dashboard.reconnectApplyHint' : 'dashboard.reconnectHint')}>
        <button className="quick-action" disabled={!connectionEnabled || network.coreState !== 'running'} onClick={() => { void handleReconnect(); }}>
          <span className="quick-icon"><Icon name={busy ? 'progress_activity' : 'restart_alt'} className={busy ? 'is-spinning' : ''} /></span>
          <span>{t(pending ? 'dashboard.reconnectApply' : 'dashboard.reconnect')}</span>
        </button>
      </Hint>
      <button className="quick-action" disabled={busy} aria-label={t('networkConfig.editNamed', { name: network.alias })} onClick={onEdit}>
        <span className="quick-icon"><Icon name="edit" /></span><span>{t('dashboard.editNetwork')}</span>
      </button>
    </div>
  </Card>;
}

export function Dashboard() {
  const { t } = useTranslation();
  const networks = useNetworkStore((state) => state.networks);
  const selectedId = useNetworkStore((state) => state.selectedId);
  const selectNetwork = useNetworkStore((state) => state.selectNetwork);
  const network = networks.find((item) => item.id === selectedId);
  const [manualCopy, setManualCopy] = useState('');
  const { openEditor, openCreator, editor } = useNetworkEditor();
  const phase = useNetworkStore((state) => state.phase);
  const notify = useSnackbar();
  const connectedCount = networks.filter(isConnected).length;
  const handleCopy = async (value: string) => {
    if (await copyText(value)) notify(t('feedback.copied', { value }));
    else setManualCopy(value);
  };
  if (phase !== 'ready' || !network) return <><ConfigurationState onAdd={openCreator} />{editor}</>;

  return <>
    <div className="network-toolbar">
      <Select value={selectedId} onChange={(id) => { void selectNetwork(id); }} label={t('dashboard.selectNetwork')} icon={network.icon} className="network-select" popupClassName="network-select-popup"
        options={networks.map((item) => ({ value: item.id, label: item.alias, icon: item.icon,
          suffix: <span className={`network-option-status ${isConnected(item) ? 'network-option-status--connected' : ''}`}>
            <span className="status-dot" />{t(`dashboard.${statusKey(item)}`)}
          </span> }))} />
      <span className="toolbar-status"><span className={`status-dot ${connectedCount ? 'status-dot--success' : ''}`} />
        {t(`dashboard.${summaryKey(networks)}`, { count: connectedCount })}</span>
      <Button variant="tonal" icon="add" onClick={openCreator}>{t('dashboard.join')}</Button>
    </div>
    <div className="dashboard-grid">
      <ConnectionCard network={network} onCopy={handleCopy} />
      <QuickActions network={network} onCopy={handleCopy}
        onEdit={() => openEditor(network.id)} />
      <TrafficCard network={network} />
      <DevicesCard network={network} onCopy={handleCopy} />
    </div>
    {editor}
    <Dialog open={Boolean(manualCopy)} onOpenChange={(open) => { if (!open) setManualCopy(''); }} title={t('dashboard.copyIp')} description={t('feedback.copyFailed')}>
      <input className="manual-copy" aria-label={t('dashboard.address')} readOnly value={manualCopy} onFocus={(event) => event.currentTarget.select()} />
    </Dialog>
  </>;
}
