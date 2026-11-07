import { useId } from 'react';
import { useTranslation } from 'react-i18next';
import { Card, Hint, Icon } from '../../components/ui';
import { formatBytes } from '../../lib/format-bytes';
import { isConnected, type Network } from '../networks/model';

function rate(value: number) {
  return value >= 1 ? { value: value.toFixed(1), unit: 'MB/s' } : { value: Math.round(value * 1000).toString(), unit: 'KB/s' };
}

export function TrafficCard({ network }: { network: Network }) {
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

