import { useId, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Chip, Dialog, Hint, Icon, IconButton, Select, Switch, useSnackbar } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { activePeers, isBusy, isConnected, statusKey, type Network, type Peer } from '../networks/model';
import { useNetworkStore } from '../networks/store';

function NetworkStatus({ network }: { network: Network }) {
  const { t } = useTranslation();
  return <Chip tone={isConnected(network) ? 'success' : isBusy(network) ? 'primary' : 'neutral'} dot>
    {t(`dashboard.${statusKey(network)}`)}
  </Chip>;
}

function ConnectionCard({ network, onCopy }: { network: Network; onCopy: (value: string) => void }) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const toggleConnection = useNetworkStore((state) => state.toggleConnection);
  const setAutoConnect = useNetworkStore((state) => state.setAutoConnect);
  const connected = isConnected(network);
  const busy = isBusy(network);
  const running = network.coreState === 'running';
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
      <div className="network-identity"><h2 title={network.alias}>{network.alias}</h2><span>{network.name}</span></div>
      <NetworkStatus network={network} />
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
        <div className="fact-value ip-value"><span className="selectable-ip">{running ? network.virtualIp : '—'}</span>
          {running && <IconButton icon="content_copy" label={t('dashboard.copyIp')} onClick={() => onCopy(network.virtualIp)} />}
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

function QuickActions({ network, onCopy, onDevices }: { network: Network; onCopy: (value: string) => void; onDevices: () => void }) {
  const { t } = useTranslation();
  return <Card className="quick-card"><h2>{t('dashboard.quickActions')}</h2>
    <div className="quick-actions">
      <Hint label={t('dashboard.soon')}><button className="quick-action" disabled>
        <span className="quick-icon"><Icon name="person_add" /></span><span>{t('dashboard.invite')}</span>
      </button></Hint>
      <button className="quick-action" disabled={network.coreState !== 'running'} onClick={() => onCopy(network.virtualIp)}>
        <span className="quick-icon"><Icon name="content_copy" /></span><span>{t('dashboard.copyIp')}</span>
      </button>
      <button className="quick-action" onClick={onDevices}>
        <span className="quick-icon"><Icon name="devices" /></span><span>{t('dashboard.devices')}</span>
      </button>
      <Link to="/networks" className="quick-action">
        <span className="quick-icon"><Icon name="tune" /></span><span>{t('dashboard.configure')}</span>
      </Link>
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
  const maximum = Math.max(1, Math.ceil(network.download * 1.25));
  const plot = (values: number[], current: number) => values.map((point, index) => {
    const x = index * 600 / (values.length - 1);
    const y = 136 - (point / values[values.length - 1]) * current / maximum * 124;
    return `${index === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(' ');
  const downloadPath = plot(network.traffic.download, network.download);
  const uploadPath = plot(network.traffic.upload, network.upload);

  return <Card className="traffic-card">
    <div className="card-heading"><h2>{t('dashboard.traffic')}</h2><span className="muted small">{t('dashboard.lastMinute')}</span></div>
    <div className="traffic-stats">
      <div className="traffic-stat"><span className="metric-label"><Icon name="arrow_downward" />{t('dashboard.download')}</span>
        <span className="metric-value">{download.value}<span>{download.unit}</span></span>
      </div>
      <div className="traffic-stat traffic-stat--upload"><span className="metric-label"><Icon name="arrow_upward" />{t('dashboard.upload')}</span>
        <span className="metric-value">{upload.value}<span>{upload.unit}</span></span>
      </div>
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
  </Card>;
}

function NetworksCard() {
  const { t } = useTranslation();
  const { networks, selectedId, selectNetwork, toggleConnection } = useNetworkStore();
  return <Card className="networks-card"><div className="card-heading"><h2>{t('dashboard.networks')}</h2>
    <span className="muted small">{t('dashboard.networkCount', { count: networks.length })}</span></div>
    <div className="network-list">{networks.map((network) => {
      const selected = selectedId === network.id;
      return <div key={network.id} className={`network-row ${selected ? 'network-row--selected' : ''}`}>
        <button className="network-row-select" onClick={() => selectNetwork(network.id)} aria-label={t('dashboard.switchHint', { name: network.alias })} aria-pressed={selected}>
          <span className={`mini-network-icon ${isConnected(network) ? 'mini-network-icon--connected' : ''}`}><Icon name={network.icon} /></span>
          <span className="network-row-text"><strong>{network.alias}</strong><span>
            <span className={`status-dot ${isConnected(network) ? 'status-dot--success' : ''}`} />
            {t(`dashboard.${statusKey(network)}`)}{isConnected(network) && <> · {t('dashboard.deviceCount', { count: network.peers.length })}</>}
          </span></span>
          {selected && <Icon name="check" className="selected-check" />}
        </button>
        <IconButton icon={isBusy(network) ? 'progress_activity' : 'power_settings_new'}
          label={t(network.coreState === 'stopped' ? 'dashboard.connectNamed' : 'dashboard.disconnectNamed', { name: network.alias })}
          disabled={isBusy(network)} className={isBusy(network) ? 'is-spinning' : ''}
          onClick={() => { void toggleConnection(network.id); }} />
      </div>;
    })}</div>
    <Link className="network-manage" to="/networks">{t('dashboard.manage')}<Icon name="arrow_forward" /></Link>
  </Card>;
}

function PeerTable({ peers, onCopy }: { peers: Peer[]; onCopy: (value: string) => void }) {
  const { t } = useTranslation();
  if (!peers.length) return <div className="devices-empty"><Icon name="devices_off" /><span>{t('dashboard.noDevices')}</span><p>{t('dashboard.noDevicesHint')}</p></div>;
  return <div className="table-scroll"><table className="device-table"><thead><tr>
    <th>{t('dashboard.device')}</th><th>{t('dashboard.address')}</th><th>{t('dashboard.connection')}</th><th>{t('dashboard.peerLatency')}</th>
  </tr></thead><tbody>{peers.map((peer) => <tr key={peer.id}>
    <td><div className="device-identity"><span className="device-icon"><Icon name={peer.platform} /></span><strong>{peer.name}</strong></div></td>
    <td><button className="copy-address" onClick={() => onCopy(peer.ip)} aria-label={t('dashboard.copyAddress', { value: peer.ip })}>
      {peer.ip}<Icon name="content_copy" /></button></td>
    <td><span className={`connection-type connection-type--${peer.connection}`}><span className="status-dot" />{t(`dashboard.${peer.connection}`)}</span></td>
    <td className="latency-cell">{peer.latency}<span className="unit">ms</span></td>
  </tr>)}</tbody></table></div>;
}

function RecentActivity() {
  const { t, i18n } = useTranslation();
  const events = useNetworkStore((state) => state.events);
  const networks = useNetworkStore((state) => state.networks);
  return <Card className="activity-card"><div className="card-heading"><h2>{t('dashboard.recent')}</h2>
    <Link to="/activity" className="text-link" aria-label={t('dashboard.allActivity')}><Icon name="arrow_forward" /></Link></div>
    <ol className="event-list">{events.slice(0, 3).map((event) => {
      const network = networks.find((item) => item.id === event.networkId);
      const detail = event.kind === 'connected' ? t('event.peers', { count: event.peerCount })
        : event.kind === 'disconnected' ? t('event.manual') : t('event.directDetail', { latency: event.latency });
      return <li className="event-row" key={event.id}><span className={`event-icon event-icon--${event.kind}`}><Icon name={event.kind === 'connected' ? 'check' : event.kind === 'direct' ? 'swap_horiz' : 'power_settings_new'} /></span>
        <div className="event-text"><p>{t(`event.${event.kind}`, { name: network?.alias, device: event.device })}</p><span>{detail}</span></div>
        <time dateTime={new Date(event.at).toISOString()}>{new Intl.DateTimeFormat(i18n.language, { hour: '2-digit', minute: '2-digit', hour12: false }).format(event.at)}</time>
      </li>;
    })}</ol>
  </Card>;
}

export function Dashboard() {
  const { t } = useTranslation();
  const { networks, selectedId, selectNetwork } = useNetworkStore();
  const network = networks.find((item) => item.id === selectedId)!;
  const peers = activePeers(network);
  const [devicesOpen, setDevicesOpen] = useState(false);
  const [manualCopy, setManualCopy] = useState('');
  const notify = useSnackbar();
  const connectedCount = networks.filter(isConnected).length;
  const handleCopy = async (value: string) => {
    if (await copyText(value)) notify(t('feedback.copied', { value }));
    else setManualCopy(value);
  };

  return <>
    <div className="network-toolbar">
      <Select value={selectedId} onChange={selectNetwork} label={t('dashboard.selectNetwork')} icon={network.icon} className="network-select"
        options={networks.map((item) => ({ value: item.id, label: item.alias, icon: item.icon,
          suffix: <span className={`status-dot ${isConnected(item) ? 'status-dot--success' : ''}`} /> }))} />
      <span className="toolbar-status"><span className={`status-dot ${connectedCount ? 'status-dot--success' : ''}`} />
        {t(connectedCount ? 'dashboard.networksOnline' : 'dashboard.allOffline', { count: connectedCount })}</span>
      <Hint label={t('dashboard.soon')}><Button variant="tonal" icon="add" disabled>{t('dashboard.join')}</Button></Hint>
    </div>
    <div className="dashboard-grid">
      <ConnectionCard network={network} onCopy={handleCopy} />
      <QuickActions network={network} onCopy={handleCopy} onDevices={() => setDevicesOpen(true)} />
      <TrafficCard network={network} />
      <NetworksCard />
      <Card className="devices-card"><div className="card-heading"><h2>{t('dashboard.devicesTitle')}<span className="heading-count">{peers.length}</span></h2>
        <Button variant="text" icon="arrow_forward" onClick={() => setDevicesOpen(true)}>{t('dashboard.allDevices')}</Button></div>
        <PeerTable peers={peers} onCopy={handleCopy} />
      </Card>
      <RecentActivity />
    </div>
    <Dialog open={devicesOpen} onOpenChange={setDevicesOpen} title={`${network.alias} · ${t('dashboard.devicesTitle')}`} description={t('dashboard.devicesOnline', { count: peers.length })}>
      <PeerTable peers={peers} onCopy={handleCopy} />
    </Dialog>
    <Dialog open={Boolean(manualCopy)} onOpenChange={(open) => { if (!open) setManualCopy(''); }} title={t('dashboard.copyIp')} description={t('feedback.copyFailed')}>
      <input className="manual-copy" aria-label={t('dashboard.address')} readOnly value={manualCopy} onFocus={(event) => event.currentTarget.select()} />
    </Dialog>
  </>;
}
