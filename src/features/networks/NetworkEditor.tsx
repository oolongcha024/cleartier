import { useId, useRef, useState } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Icon, IconButton, TextField } from '../../components/ui';
import { useHostEnvironment } from '../../platform/use-host-environment';
import type { NetworkDraft } from './configuration';
import { networkIcons, type Network } from './model';
import { useNetworkStore } from './store';
import { NetworkAdvancedFields } from './NetworkAdvancedFields';
import { useNetworkDraft } from './use-network-draft';

export function NetworkEditor({ network, open, onOpenChange }: {
  network: Network; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const networks = useNetworkStore((state) => state.networks);
  const otherTunNames = networks.filter((item) => item.id !== network.id).map((item) => item.savedConfig.tunName);
  const environment = useHostEnvironment();
  const [showSecret, setShowSecret] = useState(false);
  const aliasInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const iconLabelId = useId();
  const { draft, errors, update, save, choosing, setChoosing, advancedOpen, setAdvancedOpen, busy, canSave } = useNetworkDraft(
    network, () => onOpenChange(false),
    () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus()),
  );
  const errorText = (field: keyof NetworkDraft) => errors[field] ? t(`networkConfig.${errors[field]}`) : undefined;
  return <Dialog open={open} onOpenChange={onOpenChange} className={`network-editor ${choosing ? '' : 'network-editor--form'}`} initialFocus={aliasInput}
    title={t(choosing ? 'networkConfig.applyTitle' : 'networkConfig.editTitle')}
    description={choosing ? t('networkConfig.applyDescription', { name: draft.alias.trim() || draft.name }) : undefined}>
    {choosing ? <div className="network-apply-choice">
      <div className="network-apply-note"><Icon name="restart_alt" /><p>{t('networkConfig.applyNote')}</p></div>
      <div className="network-editor-actions">
        <Button variant="text" onClick={() => {
          setChoosing(false);
          requestAnimationFrame(() => aliasInput.current?.focus());
        }}>{t('networkConfig.back')}</Button>
        <span className="network-editor-actions-spacer" />
        <Button variant="outlined" disabled={busy} autoFocus onClick={() => save('later')}>{t('networkConfig.later')}</Button>
        <Button disabled={busy} onClick={() => save('now')}>{t('networkConfig.applyNow')}</Button>
      </div>
    </div> : <form ref={form} className="network-editor-form" noValidate onSubmit={(event) => { event.preventDefault(); save(); }}>
      <div className="network-editor-fields">
      <div className="network-icon-field">
        <span id={iconLabelId}>{t('networkConfig.icon')}</span>
        <div className="network-icon-options" role="radiogroup" aria-labelledby={iconLabelId}>
          {networkIcons.map((icon) => <label key={icon} className="network-icon-option" title={t(`networkConfig.icons.${icon}`)}>
            <input type="radio" name="icon" value={icon} checked={draft.icon === icon}
              aria-label={t(`networkConfig.icons.${icon}`)} onChange={() => update('icon', icon)} />
            <span className="network-icon-choice"><Icon name={icon} /></span>
          </label>)}
        </div>
      </div>
      <div className="network-editor-names">
        <TextField name="alias" label={t('networkConfig.alias')} value={draft.alias} onChange={(value) => update('alias', value)}
          inputRef={aliasInput} placeholder={t('networkConfig.aliasPlaceholder')} />
        <TextField name="name" label={t('networkConfig.name')} value={draft.name} onChange={(value) => update('name', value)} error={errorText('name')} />
      </div>
      <TextField name="hostname" label={t('networkConfig.hostname')} value={draft.hostname || environment?.hostname || ''}
        onChange={(value) => update('hostname', value)} error={errorText('hostname')}
        placeholder={t(environment ? 'networkConfig.hostnamePlaceholder' : 'app.loading')}
        hint={t(environment?.preview ? 'networkConfig.hostnamePreviewHint' : environment?.unavailable ? 'networkConfig.hostnameUnavailable' : 'networkConfig.hostnameHint')}
        trailing={<IconButton icon="restart_alt" label={t('networkConfig.resetHostname')} disabled={!environment?.hostname || !draft.hostname}
          onClick={() => update('hostname', '')} />} />
      <TextField name="secret" label={t('networkConfig.secret')} value={draft.secret} type={showSecret ? 'text' : 'password'}
        onChange={(value) => update('secret', value)} hint={t('networkConfig.secretHint')}
        trailing={<IconButton icon={showSecret ? 'visibility_off' : 'visibility'} label={t(showSecret ? 'networkConfig.hideSecret' : 'networkConfig.showSecret')}
          aria-pressed={showSecret} onClick={() => setShowSecret((value) => !value)} />} />
      <TextField name="servers" label={t('networkConfig.servers')} multiline value={draft.servers}
        onChange={(value) => update('servers', value)} hint={t('networkConfig.serversHint')} error={errorText('servers')} />
      <Collapsible.Root className="network-advanced" open={advancedOpen} onOpenChange={setAdvancedOpen}>
        <h3 className="network-advanced-heading">
          <Collapsible.Trigger id={`${iconLabelId}-advanced-trigger`} className="network-advanced-toggle" aria-controls={`${iconLabelId}-advanced`}>
            <Icon name="tune" /><span>{t('networkConfig.advanced')}</span><Icon name="expand_more" />
          </Collapsible.Trigger>
        </h3>
        <Collapsible.Panel keepMounted id={`${iconLabelId}-advanced`} className="network-advanced-panel"
          role="region" aria-labelledby={`${iconLabelId}-advanced-trigger`}>
          <NetworkAdvancedFields draft={draft} errors={errors} update={update} network={network}
            otherTunNames={otherTunNames} environment={environment} />
        </Collapsible.Panel>
      </Collapsible.Root>
      </div>
      <div className="network-editor-actions">
        <Button variant="text" onClick={() => onOpenChange(false)}>{t('networkConfig.cancel')}</Button>
        <Button type="submit" disabled={busy || !canSave}>{t('networkConfig.save')}</Button>
      </div>
    </form>}
  </Dialog>;
}
