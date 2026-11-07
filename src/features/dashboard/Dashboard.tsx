import { useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Dialog, Hint, Icon, IconButton, Select, Switch, useSnackbar } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { formatBytes } from '../../lib/format-bytes';
import { activePeers, activeVirtualIp, isBusy, isConnected, statusKey, type Network } from '../networks/model';
import { useNetworkStore } from '../networks/store';
import { NetworkStatus } from '../networks/NetworkStatus';
import { NetworkEditor } from '../networks/NetworkEditor';
import { hasPendingConfig } from '../networks/configuration';
import { PeerTable } from './PeerTable';

function ConnectionCard({ network, onCopy }: { network: Network; onCopy: (value: string) => void }) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const toggleConnection = useNetworkStore((state) => state.toggleConnection);
  const setAutoConnect = useNetworkStore((state) => state.setAutoConnect);
  const connected = isConnected(network);
  const busy = isBusy(network);
  const running = network.coreState === 'running';
  const name = (network.runningConfig ?? network.savedConfig).name;
  const title = network.coreState === 'stopped' ? 'disconnected'
    : network.coreState === 'starting' ? 'starting'
      : network.coreState === 'stopping' ? 'stopping' : connected ? 'connected' : 'waiting';
  const detail = network.coreState === 'stopped' ? t('dashboard.offlineHint')
    : network.coreState === 'starting' ? t('dashboard.startingHint')
      : network.coreState === 'stopping' ? t('dashboard.stoppingHint')
        : connected ? t('dashboard.peers', { count: network.peers.length, direct: network.peers.filter((peer) => peer.connection === 'direct').length })
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
      <Button variant={running ? 'outlined' : 'filled'} icon={busy ? undefined : 'power_settings_new'} disabled={busy}
        onClick={() => { void toggleConnection(network.id); }}>
        {t(`dashboard.${busy ? statusKey(network) : running ? 'disconnect' : 'connect'}`)}
      </Button>
    </div>
    <div className="connection-facts">
      <div className="connection-fact"><span className="fact-label">{t('dashboard.virtualIp')}</span>
        <div className="fact-value ip-value"><span className="selectable-ip">{running ? activeVirtualIp(network) : '—'}</span>
          {running && <IconButton icon="content_copy" label={t('dashboard.copyIp')} onClick={() => onCopy(activeVirtualIp(network))} />}
        </div>
      </div>
      <div className="connection-fact"><span className="fact-label">{t('dashboard.latency')}</span>
        <div className="fact-value">{connected ? <>{network.entryLatency}<span className="unit">ms</span></> : '—'}</div>
      </div>
      <div className="connection-fact"><span className="fact-label">{t('dashboard.autoConnect')}</span>
        <div className="fact-value"><Switch checked={network.autoConnect} label={t('dashboard.autoConnectLabel', { name: network.alias })}
          onChange={(enabled) => {
            setAutoConnect(network.id, enabled);
            notify(t(enabled ? 'feedback.autoOn' : 'feedback.autoOff', { name: network.alias }));
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
  const pending = hasPendingConfig(network);
  const busy = isBusy(network);
  const handleReconnect = async () => {
    const restarting = reconnect(network.id);
    notify(t(pending ? 'feedback.reconnectingApply' : 'feedback.reconnecting', { name: network.alias }));
    if (await restarting) notify(t('feedback.reconnected', { name: network.alias }));
  };
  return <Card className="quick-card"><h2>{t('dashboard.quickActions')}</h2>
    <div className="quick-actions">
      <Hint label={t('dashboard.soon')}><button className="quick-action" disabled>
        <span className="quick-icon"><Icon name="person_add" /></span><span>{t('dashboard.invite')}</span>
      </button></Hint>
      <button className="quick-action" disabled={network.coreState !== 'running'} onClick={() => onCopy(activeVirtualIp(network))}>
        <span className="quick-icon"><Icon name="content_copy" /></span><span>{t('dashboard.copyIp')}</span>
      </button>
      <Hint label={t(pending ? 'dashboard.reconnectApplyHint' : 'dashboard.reconnectHint')}>
        <button className="quick-action" disabled={network.coreState !== 'running'} onClick={() => { void handleReconnect(); }}>
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

function rate(value: number) {
  return value >= 1 ? { value: value.toFixed(1), unit: 'MB/s' } : { value: Math.round(value * 1000).toString(), unit: 'KB/s' };
}

function TrafficCard({ network }: { network: Network }) {
  const { t } = useTranslation();
  const gradientId = useId();
  const connected = isConnected(network);
  const download = rate(connected ? network.download : 0);
  const upload = rate(connected ? network.upload : 0);
  const totalDownload = formatBytes(network.trafficTotals?.downloadBytes);
  const totalUpload = formatBytes(network.trafficTotals?.uploadBytes);
  const maximum = Math.max(1, Math.ceil(network.download * 1.25));
  const plot = (values: number[], current: number) => values.map((point, index) => {
    const x = index * 600 / (values.length - 1);
    const y = 136 - (point / values[values.length - 1]) * current / maximum * 124;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const downloadPath = plot(network.traffic.download, network.download);
  const uploadPath = plot(network.traffic.upload, network.upload);

  return <Card className="traffic-card">
    <div className="card-heading"><h2>{t('dashboard.traffic')}</h2></div>
    <div className="traffic-body">
      <div className="traffic-stats">
        <div className="traffic-stat"><span className="metric-label"><Icon name="arrow_downward" />{t('dashboard.download')}</span>
          <span className="metric-value">{download.value}<span>{download.unit}</span></span>
          <dl className="traffic-total" aria-label={t('dashboard.totalDownload')}>
            <dt><Hint label={t('dashboard.trafficTotalsHint')}><span>{t('dashboard.totalTraffic')}</span></Hint></dt>
            <dd>{totalDownload.value}{totalDownload.unit && <span>{totalDownload.unit}</span>}</dd>
          </dl>
        </div>
        <div className="traffic-stat traffic-stat--upload"><span className="metric-label"><Icon name="arrow_upward" />{t('dashboard.upload')}</span>
          <span className="metric-value">{upload.value}<span>{upload.unit}</span></span>
          <dl className="traffic-total" aria-label={t('dashboard.totalUpload')}>
            <dt><Hint label={t('dashboard.trafficTotalsHint')}><span>{t('dashboard.totalTraffic')}</span></Hint></dt>
            <dd>{totalUpload.value}{totalUpload.unit && <span>{totalUpload.unit}</span>}</dd>
          </dl>
        </div>
      </div>
      <div className="traffic-trend">
        <div className="traffic-trend-heading"><span className="muted small">{t('dashboard.lastMinute')}</span>
          <div className="chart-legend"><span><i />{t('dashboard.download')}</span><span><i />{t('dashboard.upload')}</span></div>
        </div>
        <div className={`traffic-chart ${connected ? '' : 'traffic-chart--offline'}`}>
          <div className="chart-scale" aria-hidden="true"><span>{connected ? maximum : 0} MB/s</span><span>{connected ? maximum / 2 : 0}</span><span>0</span></div>
          <svg viewBox="0 0 600 144" preserveAspectRatio="none" role="img"
            aria-label={t('dashboard.chartLabel', { name: network.alias, upload: `${upload.value} ${upload.unit}`, download: `${download.value} ${download.unit}` })}>
            <defs><linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--md-sys-color-primary)" stopOpacity=".18" />
              <stop offset="100%" stopColor="var(--md-sys-color-primary)" stopOpacity="0" />
            </linearGradient></defs>
            {[12, 74, 136].map((y) => <line key={y} x1="0" x2="600" y1={y} y2={y} className="chart-grid" />)}
            {connected && <>
              <path d={`${downloadPath} L600,144 L0,144 Z`} fill={`url(#${gradientId})`} />
              <path d={downloadPath} className="chart-line chart-line--download" />
              <path d={uploadPath} className="chart-line chart-line--upload" />
            </>}
          </svg>
          {!connected && <span className="chart-empty">{t('dashboard.trafficOffline')}</span>}
        </div>
        <div className="chart-time" aria-hidden="true"><span>{t('dashboard.sixtyAgo')}</span><span>{t('dashboard.thirtyAgo')}</span><span>{t('dashboard.now')}</span></div>
      </div>
    </div>
  </Card>;
}

export function Dashboard() {
  const { t } = useTranslation();
  const { networks, selectedId, selectNetwork } = useNetworkStore();
  const network = networks.find((item) => item.id === selectedId)!;
  const peers = activePeers(network);
  const [manualCopy, setManualCopy] = useState('');
  const [editor, setEditor] = useState({ id: '', open: false, session: 0 });
  const editingNetwork = networks.find((item) => item.id === editor.id);
  const notify = useSnackbar();
  const connectedCount = networks.filter(isConnected).length;
  const handleCopy = async (value: string) => {
    if (await copyText(value)) notify(t('feedback.copied', { value }));
    else setManualCopy(value);
  };

  return <>
    <div className="network-toolbar">
      <Select value={selectedId} onChange={selectNetwork} label={t('dashboard.selectNetwork')} icon={network.icon} className="network-select" popupClassName="network-select-popup"
        options={networks.map((item) => ({ value: item.id, label: item.alias, icon: item.icon,
          suffix: <span className={`network-option-status ${isConnected(item) ? 'network-option-status--connected' : ''}`}>
            <span className="status-dot" />{t(`dashboard.${statusKey(item)}`)}
          </span> }))} />
      <span className="toolbar-status"><span className={`status-dot ${connectedCount ? 'status-dot--success' : ''}`} />
        {t(connectedCount ? 'dashboard.networksOnline' : 'dashboard.allOffline', { count: connectedCount })}</span>
      <Hint label={t('dashboard.soon')}><Button variant="tonal" icon="add" disabled>{t('dashboard.join')}</Button></Hint>
    </div>
    <div className="dashboard-grid">
      <ConnectionCard network={network} onCopy={handleCopy} />
      <QuickActions network={network} onCopy={handleCopy}
        onEdit={() => setEditor((current) => ({ id: network.id, open: true, session: current.session + 1 }))} />
      <TrafficCard network={network} />
      <Card className="devices-card"><div className="card-heading"><h2>{t('dashboard.devicesTitle')}<span className="heading-count">{peers.length}</span></h2></div>
        <PeerTable peers={peers} onCopy={handleCopy} />
      </Card>
    </div>
    {editingNetwork && <NetworkEditor key={editor.session} network={editingNetwork} open={editor.open}
      onOpenChange={(open) => setEditor((current) => ({ ...current, open }))} />}
    <Dialog open={Boolean(manualCopy)} onOpenChange={(open) => { if (!open) setManualCopy(''); }} title={t('dashboard.copyIp')} description={t('feedback.copyFailed')}>
      <input className="manual-copy" aria-label={t('dashboard.address')} readOnly value={manualCopy} onFocus={(event) => event.currentTarget.select()} />
    </Dialog>
  </>;
}
