import { useId, useMemo, useRef, useState } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { useTranslation } from 'react-i18next';
import { useNavigate } from 'react-router';
import { Button, Dialog, Icon, IconButton, TextField } from '../../components/ui';
import { useHostEnvironment } from '../../platform/use-host-environment';
import { draftConfig, type NetworkDraft } from './configuration';
import { isDesktop } from '../../platform/client';
import { ConfigurationCompatibility, useCompatibility } from './ConfigurationCompatibility';
import { networkIcons, type Network } from './model';
import { useNetworkStore } from './store';
import { NetworkAdvancedFields } from './NetworkAdvancedFields';
import { useNetworkDraft } from './use-network-draft';
import { useInvitationField } from '../invitations/use-invitation-field';

export function NetworkEditor({ network, open, onOpenChange, creating = false }: {
  network: Network; open: boolean; onOpenChange: (open: boolean) => void; creating?: boolean;
}) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const networks = useNetworkStore((state) => state.networks);
  const otherTunNames = networks.filter((item) => item.id !== network.id).map((item) => item.savedConfig.tunName);
  const environment = useHostEnvironment();
  const [showSecret, setShowSecret] = useState(false);
  const aliasInput = useRef<HTMLInputElement>(null);
  const invitationInput = useRef<HTMLTextAreaElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const iconLabelId = useId();
  const { draft, errors, update, acceptInvitation, save, openExisting, choosing, setChoosing, duplicate, setDuplicate, discarding, setDiscarding,
    requestClose, saving, saveError, advancedOpen, setAdvancedOpen, busy, canSave } = useNetworkDraft(
    network, creating, () => onOpenChange(false),
    () => requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]:not([name="invitation"])')?.focus()),
  );
  const invitation = useInvitationField(acceptInvitation, invitationInput,
    () => aliasInput.current?.focus({ preventScroll: true }));
  const errorText = (field: keyof NetworkDraft) => errors[field] ? t(`networkConfig.${errors[field]}`) : undefined;
  const imported = network.savedConfig.officialToml !== undefined;
  const proposedConfig = useMemo(() => draftConfig(draft, network.savedConfig), [draft, network.savedConfig]);
  const compatibility = useCompatibility(network.id, proposedConfig, imported && isDesktop());
  const requestExit = () => {
    if (saving) return;
    if (creating && invitation.dirty) setDiscarding(true);
    else requestClose();
  };
  const focusForm = () => {
    // Keep a stable focus target while the confirmation's focused button unmounts.
    document.activeElement?.closest<HTMLElement>('.dialog-popup')?.focus({ preventScroll: true });
    requestAnimationFrame(() => (creating ? invitationInput.current ?? aliasInput.current : aliasInput.current)?.focus({ preventScroll: true }));
  };
  const choice = choosing || duplicate || discarding;
  return <Dialog open={open} onOpenChange={(next) => { if (!next) requestExit(); }} className={`network-editor ${choice ? '' : 'network-editor--form'}`} initialFocus={choice ? undefined : creating ? invitationInput : aliasInput}
    title={t(discarding ? 'networkConfig.discardTitle' : duplicate ? 'networkConfig.duplicateTitle' : choosing ? 'networkConfig.applyTitle' : creating ? 'networkConfig.addTitle' : 'networkConfig.editTitle')}
    description={discarding ? t('networkConfig.discardDescription') : duplicate ? t('networkConfig.duplicateDescription', { name: duplicate.alias })
      : choosing ? t('networkConfig.applyDescription', { name: draft.alias.trim() || draft.name }) : undefined}>
    {discarding ? <div className="network-apply-choice">
      <div className="network-editor-actions"><Button variant="text" onClick={() => { setDiscarding(false); focusForm(); }}>{t('networkConfig.keepEditing')}</Button>
        <Button onClick={() => onOpenChange(false)}>{t('networkConfig.discard')}</Button></div>
    </div> : duplicate ? <div className="network-apply-choice">
      {saveError && <p className="configuration-error-text" role="alert">{t('configuration.saveFailed')}</p>}
      <div className="network-editor-actions"><Button variant="text" disabled={saving} onClick={() => { setDuplicate(null); focusForm(); }}>{t('networkConfig.back')}</Button>
        <Button variant="outlined" disabled={saving} onClick={() => { void save('confirm', true); }}>{t('networkConfig.addAnyway')}</Button>
        <Button disabled={saving} onClick={async () => { if (await openExisting()) navigate('/'); }}>{t('invitation.openExisting')}</Button></div>
    </div> : choosing ? <div className="network-apply-choice">
      <div className="network-apply-note"><Icon name="restart_alt" /><p>{t('networkConfig.applyNote')}</p></div>
      <div className="network-editor-actions">
        <Button variant="text" onClick={() => {
          setChoosing(false);
          focusForm();
        }}>{t('networkConfig.back')}</Button>
        <span className="network-editor-actions-spacer" />
        <Button variant="outlined" disabled={busy} autoFocus onClick={() => save('later')}>{t('networkConfig.later')}</Button>
        <Button disabled={busy || (imported && (compatibility.checking || compatibility.error || Boolean(compatibility.report?.issues.length)))} onClick={() => save('now')}>{t('networkConfig.applyNow')}</Button>
      </div>
    </div> : <form ref={form} className="network-editor-form" noValidate onSubmit={(event) => { event.preventDefault(); void save(); }}>
      <fieldset className="network-editor-fields" disabled={saving}>
      <div className="network-editor-intro">
        {creating && invitation.field}
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
      {imported && <ConfigurationCompatibility {...compatibility} />}
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
      </fieldset>
      <div className="network-editor-actions">
        {saveError && <p className="configuration-error-text" role="alert">{t('configuration.saveFailed')}</p>}
        <Button variant="text" disabled={saving} onClick={requestExit}>{t('networkConfig.cancel')}</Button>
        <Button type="submit" disabled={busy || !canSave}>{t(saving ? 'networkConfig.saving' : creating ? 'networkConfig.addTitle' : 'networkConfig.save')}</Button>
      </div>
    </form>}
  </Dialog>;
}
