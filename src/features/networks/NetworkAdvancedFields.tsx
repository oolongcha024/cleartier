import { useTranslation } from 'react-i18next';
import { Hint, Icon, IconButton, Select, Switch, TextField } from '../../components/ui';
import type { HostEnvironment } from '../../platform/client';
import type { DraftErrors, NetworkDraft, UpdateNetworkDraft } from './configuration';
import { defaultTunName } from './defaults';
import { p2pPolicies, type Network } from './model';

function ToggleRow({
  label,
  hint,
  checked,
  onChange,
  disabled = false,
}: {
  label: string;
  hint?: string;
  checked: boolean;
  onChange: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <div className={`network-option-row ${disabled ? 'network-option-row--disabled' : ''}`}>
      <span>
        {label}
        {hint && (
          <Hint label={hint}>
            <span className="network-option-help" tabIndex={0} aria-label={hint}>
              <Icon name="help" />
            </span>
          </Hint>
        )}
      </span>
      <Switch label={label} checked={checked} onChange={onChange} disabled={disabled} />
    </div>
  );
}

export function NetworkAdvancedFields({
  draft,
  errors,
  update,
  network,
  otherTunNames,
  environment,
}: {
  draft: NetworkDraft;
  errors: DraftErrors;
  update: UpdateNetworkDraft;
  network: Network;
  otherTunNames: string[];
  environment: HostEnvironment | null;
}) {
  const { t } = useTranslation();
  const errorText = (field: keyof NetworkDraft) =>
    errors[field] ? t(`networkConfig.${errors[field]}`) : undefined;
  const macos = environment?.platform === 'macos';
  return (
    <div className="network-advanced-fields">
      <section className="network-advanced-section" aria-labelledby="network-address-heading">
        <h3 id="network-address-heading">{t('networkConfig.addressGroup')}</h3>
        <div className="network-option-row">
          <span>{t('networkConfig.ipv4Assignment')}</span>
          <Select
            label={t('networkConfig.ipv4Assignment')}
            value={draft.ipv4Mode}
            onChange={(value) => {
              update('ipv4Mode', value as NetworkDraft['ipv4Mode']);
              if (value === 'manual' && !draft.ipv4Address)
                update('ipv4Address', network.virtualIp);
            }}
            options={['auto', 'manual', 'none'].map((value) => ({
              value,
              label: t(`networkConfig.ipv4Modes.${value}`),
            }))}
          />
        </div>
        {draft.ipv4Mode === 'manual' && (
          <div className="network-editor-address">
            <TextField
              name="ipv4Address"
              label={t('networkConfig.ipv4Address')}
              value={draft.ipv4Address}
              onChange={(value) => update('ipv4Address', value)}
              error={errorText('ipv4Address')}
            />
            <TextField
              name="ipv4Prefix"
              label={t('networkConfig.ipv4Prefix')}
              value={draft.ipv4Prefix}
              inputMode="numeric"
              onChange={(value) => update('ipv4Prefix', value)}
              error={errorText('ipv4Prefix')}
            />
          </div>
        )}
        <TextField
          name="tunName"
          label={t('networkConfig.tunName')}
          value={macos ? t('networkConfig.systemAssigned') : draft.tunName}
          disabled={macos}
          onChange={(value) => update('tunName', value)}
          error={macos ? undefined : errorText('tunName')}
          hint={t(macos ? 'networkConfig.tunMacHint' : 'networkConfig.tunHint')}
          trailing={
            !macos && (
              <IconButton
                icon="restart_alt"
                label={t('networkConfig.resetTun')}
                onClick={() => update('tunName', defaultTunName(network.id, otherTunNames))}
              />
            )
          }
        />
        <TextField
          name="mtu"
          label={t('networkConfig.mtu')}
          value={draft.mtu}
          inputMode="numeric"
          placeholder={t('networkConfig.coreDefault')}
          hint={t('networkConfig.mtuHint')}
          onChange={(value) => update('mtu', value)}
          error={errorText('mtu')}
        />
        <ToggleRow
          label={t('networkConfig.ipv6')}
          hint={t('networkConfig.ipv6Hint')}
          checked={draft.ipv6}
          onChange={(value) => update('ipv6', value)}
        />
      </section>
      <section className="network-advanced-section" aria-labelledby="network-p2p-heading">
        <h3 id="network-p2p-heading">{t('networkConfig.connectionGroup')}</h3>
        <div className="network-option-row">
          <span>{t('networkConfig.p2pPolicy')}</span>
          <Select
            label={t('networkConfig.p2pPolicy')}
            value={draft.p2pPolicy}
            onChange={(value) => {
              update('p2pPolicy', value as NetworkDraft['p2pPolicy']);
              if (value === 'only') update('latencyFirst', false);
            }}
            options={p2pPolicies.map((value) => ({
              value,
              label: t(`networkConfig.p2pPolicies.${value}`),
            }))}
          />
        </div>
        <p className="network-option-note">{t(`networkConfig.p2pHints.${draft.p2pPolicy}`)}</p>
        <ToggleRow
          label={t('networkConfig.latencyFirst')}
          hint={t(
            draft.p2pPolicy === 'only'
              ? 'networkConfig.latencyOnlyHint'
              : 'networkConfig.latencyHint',
          )}
          checked={draft.latencyFirst}
          disabled={draft.p2pPolicy === 'only' && !draft.latencyFirst}
          onChange={(value) => update('latencyFirst', value)}
        />
        <ToggleRow
          label={t('networkConfig.tcpHolePunching')}
          checked={draft.tcpHolePunching}
          onChange={(value) => update('tcpHolePunching', value)}
        />
        <ToggleRow
          label={t('networkConfig.udpHolePunching')}
          checked={draft.udpHolePunching}
          onChange={(value) => update('udpHolePunching', value)}
        />
        <ToggleRow
          label={t('networkConfig.upnp')}
          hint={t('networkConfig.upnpHint')}
          checked={draft.upnp}
          onChange={(value) => update('upnp', value)}
        />
      </section>
      <section className="network-advanced-section" aria-labelledby="network-services-heading">
        <h3 id="network-services-heading">{t('networkConfig.servicesGroup')}</h3>
        <ToggleRow
          label={t('networkConfig.magicDns')}
          hint={t('networkConfig.dnsHint')}
          checked={draft.magicDns}
          onChange={(value) => update('magicDns', value)}
        />
        {draft.magicDns && (
          <TextField
            name="dnsSuffix"
            label={t('networkConfig.dnsSuffix')}
            value={draft.dnsSuffix}
            onChange={(value) => update('dnsSuffix', value)}
            error={errorText('dnsSuffix')}
          />
        )}
        {environment?.platform === 'windows' && (
          <ToggleRow
            label={t('networkConfig.udpBroadcastRelay')}
            hint={t('networkConfig.broadcastHint')}
            checked={draft.udpBroadcastRelay}
            onChange={(value) => update('udpBroadcastRelay', value)}
          />
        )}
      </section>
    </div>
  );
}
