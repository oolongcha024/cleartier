import { Fragment, useId, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Hint, Icon } from '../../components/ui';
import type { PeerIconPreferences } from '../networks/peer-icons';
import { PeerIconPicker } from './PeerIconPicker';
import type { Peer } from '../networks/model';

export function PeerTable({
  networkId,
  peers,
  preferences = {},
  onCopy,
  stale = false,
}: {
  networkId: string;
  peers: Peer[];
  preferences?: PeerIconPreferences;
  onCopy: (value: string) => void;
  stale?: boolean;
}) {
  const { t } = useTranslation();
  const prefix = useId();
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  if (!peers.length)
    return (
      <div className="devices-empty">
        <Icon name="devices_off" />
        <span>{t(stale ? 'dashboard.dataStale' : 'dashboard.noDevices')}</span>
        {!stale && <p>{t('dashboard.noDevicesHint')}</p>}
      </div>
    );
  return (
    <div className="table-scroll">
      <table className="device-table">
        <colgroup>
          <col className="device-column-name" />
          <col className="device-column-address" />
          <col className="device-column-connection" />
          <col className="device-column-metric" />
          <col className="device-column-metric" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">{t('dashboard.device')}</th>
            <th scope="col">{t('dashboard.address')}</th>
            <th scope="col">{t('dashboard.connection')}</th>
            <th scope="col" className="device-metric">
              {t('dashboard.peerLatency')}
            </th>
            <th scope="col" className="device-metric">
              <Hint label={t('dashboard.lossHint')}>
                <span>{t('dashboard.lossRate')}</span>
              </Hint>
            </th>
          </tr>
        </thead>
        <tbody>
          {peers.map((peer) => {
            const open = expanded.has(peer.id);
            const detailsId = `${prefix}-${peer.id}`;
            return (
              <Fragment key={peer.id}>
                <tr className="device-row">
                  <td>
                    <div className="device-identity">
                      <PeerIconPicker networkId={networkId} peer={peer} preferences={preferences} />
                      <button
                        className="device-expand"
                        aria-expanded={open}
                        aria-controls={detailsId}
                        onClick={() =>
                          setExpanded((previous) => {
                            const next = new Set(previous);
                            if (next.has(peer.id)) next.delete(peer.id);
                            else next.add(peer.id);
                            return next;
                          })
                        }
                      >
                        <strong title={peer.name}>{peer.name}</strong>
                        <Icon name={open ? 'expand_less' : 'expand_more'} />
                      </button>
                    </div>
                  </td>
                  <td>
                    {peer.ip ? (
                      <button
                        className="copy-address"
                        onClick={() => onCopy(peer.ip!)}
                        aria-label={t('dashboard.copyAddress', { value: peer.ip })}
                        title={peer.ip}
                      >
                        <span className="device-address-text">{peer.ip}</span>
                        <Icon name="content_copy" />
                      </button>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td>
                    <span className={`connection-type connection-type--${peer.connection}`}>
                      <span className="status-dot" />
                      {t(`dashboard.${peer.connection}`)}
                    </span>
                  </td>
                  <td className="device-metric">
                    {!stale && peer.latency !== null ? (
                      <>
                        {peer.latency.toFixed(1)}
                        <span className="unit">ms</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                  <td className="device-metric">
                    {!stale && peer.lossRate !== null && peer.lossRate !== undefined ? (
                      <>
                        {(peer.lossRate * 100).toFixed(1)}
                        <span className="unit">%</span>
                      </>
                    ) : (
                      '—'
                    )}
                  </td>
                </tr>
                <tr className="device-details" id={detailsId} hidden={!open}>
                  <td colSpan={5}>
                    <div className="device-detail-panel">
                      <dl>
                        <div>
                          <dt>{t('dashboard.protocol')}</dt>
                          <dd>{peer.protocols?.join(' / ') || '—'}</dd>
                        </div>
                        <div>
                          <dt>{t('dashboard.nextHop')}</dt>
                          <dd>
                            {peer.connection === 'direct'
                              ? t('dashboard.direct')
                              : peer.nextHop || '—'}
                          </dd>
                        </div>
                        <div>
                          <dt>{t('dashboard.coreVersion')}</dt>
                          <dd>{peer.version || '—'}</dd>
                        </div>
                      </dl>
                    </div>
                  </td>
                </tr>
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
