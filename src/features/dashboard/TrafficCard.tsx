import { useTranslation } from 'react-i18next';
import { Card, Hint, Icon } from '../../components/ui';
import { formatBytes } from '../../lib/format-bytes';
import type { Network } from '../networks/model';
import { useDashboardTelemetry } from './use-dashboard-telemetry';
import { trafficChart } from './traffic-chart';

export function TrafficCard({ network }: { network: Network }) {
  const { t } = useTranslation();
  const telemetry = useDashboardTelemetry(network);
  const { snapshot, freshness } = telemetry;
  const running = network.coreState === 'running';
  const stale = freshness === 'stale' || network.coreState === 'unknown';
  const available = running && freshness === 'fresh';
  const rate = (value: number | null) => {
    const formatted = formatBytes(available ? value ?? undefined : undefined);
    return { ...formatted, unit: formatted.unit ? `${formatted.unit}/s` : '' };
  };
  const download = rate(telemetry.download), upload = rate(telemetry.upload);
  const totalDownload = formatBytes(snapshot ? Number(snapshot.downloadBytes) : undefined);
  const totalUpload = formatBytes(snapshot ? Number(snapshot.uploadBytes) : undefined);
  const chart = trafficChart(telemetry.points);
  const scale = formatBytes(chart.scale);
  const empty = !running ? 'dashboard.trafficOffline' : stale ? 'dashboard.dataStale' : 'dashboard.sampling';

  return <Card className="traffic-card">
    <div className="card-heading"><h2>{t('dashboard.traffic')}</h2>{stale && <span className="data-status" role="status">{t('dashboard.dataStale')}</span>}
      {snapshot?.incomplete && <Hint label={t('dashboard.incompleteHint')}><span className="data-status">{t('dashboard.incomplete')}</span></Hint>}
    </div>
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
        <div className={`traffic-chart ${available ? '' : 'traffic-chart--offline'}`}>
          <div className="chart-scale" aria-hidden="true"><span>{scale.value} {scale.unit}/s</span><span>{(chart.scale / 2 / (1024 ** Math.floor(Math.log(chart.scale) / Math.log(1024)))).toFixed(1)}</span><span>0</span></div>
          <svg viewBox="0 0 600 144" preserveAspectRatio="none" role="img"
            aria-label={t('dashboard.chartLabel', { name: network.alias, upload: `${upload.value} ${upload.unit}`, download: `${download.value} ${download.unit}` })}>
            {[12, 74, 136].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y} className="chart-grid" />)}
            {running && <>
              {chart.download.map((path, index) => <path key={index} d={path} className="chart-line chart-line--download" />)}
              {chart.upload.map((path, index) => <path key={index} d={path} className="chart-line chart-line--upload" />)}
            </>}
          </svg>
          {(!available || telemetry.download === null) && <span className="chart-empty">{t(empty)}</span>}
        </div>
        <div className="chart-time" aria-hidden="true"><span>{t('dashboard.sixtyAgo')}</span><span>{t('dashboard.thirtyAgo')}</span><span>{t('dashboard.now')}</span></div>
      </div>
    </div>
  </Card>;
}
