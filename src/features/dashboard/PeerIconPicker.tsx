import { Menu } from '@base-ui/react/menu';
import { useTranslation } from 'react-i18next';
import { Hint, Icon } from '../../components/ui';
import { peerIcon, peerIconChoice, peerIconKey, peerIconKinds, peerIconNames, type PeerIconChoice, type PeerIconPreferences } from '../networks/peer-icons';
import type { Peer } from '../networks/model';
import { useNetworkStore } from '../networks/store';

export function PeerIconPicker({ networkId, peer, preferences }: { networkId: string; peer: Peer; preferences: PeerIconPreferences }) {
  const { t } = useTranslation();
  const setPeerIcon = useNetworkStore((state) => state.setPeerIcon);
  const writing = useNetworkStore((state) => state.writing);
  const key = peerIconKey(peer);
  const choice = peerIconChoice(peer, preferences);
  const label = t('dashboard.deviceIconNamed', { name: peer.name });
  const hint = key ? `${t('dashboard.changeDeviceIcon')} · ${choice === 'auto' && peer.publicServer ? t('dashboard.publicServer') : t(`dashboard.deviceIcons.${choice}`)}` : t('dashboard.deviceIconUnavailable');
  const options = [{ value: 'auto', icon: peerIcon(peer) }, ...peerIconKinds.map((kind) => ({ value: kind, icon: peerIconNames[kind] }))];
  return <Menu.Root>
    <Hint label={hint}><Menu.Trigger className="device-icon-trigger" aria-label={label} aria-busy={writing || undefined} disabled={!key}>
      <span className="device-icon"><Icon name={peerIcon(peer, preferences)} /></span>
    </Menu.Trigger></Hint>
    <Menu.Portal><Menu.Positioner side="bottom" align="start" sideOffset={4} className="peer-icon-positioner">
      <Menu.Popup className="peer-icon-menu" aria-label={label}>
        <Menu.RadioGroup value={choice} disabled={writing} onValueChange={(value: PeerIconChoice) => { if (key && !writing) void setPeerIcon(networkId, key, value); }}>
          {options.map((option) => <Menu.RadioItem key={option.value} value={option.value} label={t(`dashboard.deviceIcons.${option.value}`)} closeOnClick className="peer-icon-menu-item">
            <Icon name={option.icon} /><span className="peer-icon-menu-label">{t(`dashboard.deviceIcons.${option.value}`)}</span>
            <span className="peer-icon-menu-check">{choice === option.value && <Icon name="check" />}</span>
          </Menu.RadioItem>)}
        </Menu.RadioGroup>
      </Menu.Popup>
    </Menu.Positioner></Menu.Portal>
  </Menu.Root>;
}
