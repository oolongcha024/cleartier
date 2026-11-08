import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import type { Peer } from '../networks/model';

export function PeerTable({ peers, onCopy, detailsPending = false }: { peers: Peer[]; onCopy: (value: string) => void; detailsPending?: boolean }) {
  const { t } = useTranslation();
  if (!peers.length) return <div className="devices-empty"><Icon name="devices_off" /><span>{t(detailsPending ? 'connection.deviceDetailsPending' : 'dashboard.noDevices')}</span>{!detailsPending && <p>{t('dashboard.noDevicesHint')}</p>}</div>;
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
