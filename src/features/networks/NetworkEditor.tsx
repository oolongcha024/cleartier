import { useId, useRef, useState, type FormEvent } from 'react';
import { Collapsible } from '@base-ui/react/collapsible';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, Icon, IconButton, TextField, useSnackbar } from '../../components/ui';
import { useHostEnvironment } from '../../lib/host-environment';
import { configurationDraft, configsEqual, draftConfig, hasPendingConfig, validateDraft, type DraftErrors, type NetworkDraft } from './configuration';
import { isBusy, networkIcons, type Network } from './model';
import { useNetworkStore } from './store';
import { NetworkAdvancedFields } from './NetworkAdvancedFields';

export function NetworkEditor({ network, open, onOpenChange }: {
  network: Network; open: boolean; onOpenChange: (open: boolean) => void;
}) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const saveConfiguration = useNetworkStore((state) => state.saveConfiguration);
  const applyConfiguration = useNetworkStore((state) => state.applyConfiguration);
  const networks = useNetworkStore((state) => state.networks);
  const otherTunNames = networks.filter((item) => item.id !== network.id).map((item) => item.savedConfig.tunName);
  const environment = useHostEnvironment();
  const [draft, setDraft] = useState(() => configurationDraft(network));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [showSecret, setShowSecret] = useState(false);
  const [choosing, setChoosing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const aliasInput = useRef<HTMLInputElement>(null);
  const form = useRef<HTMLFormElement>(null);
  const iconLabelId = useId();
  const busy = isBusy(network);
  const localChanged = draft.alias !== network.alias || draft.icon !== network.icon;
  const changed = localChanged || !configsEqual(draftConfig(draft, network.savedConfig), network.savedConfig);
  const update = <Field extends keyof NetworkDraft>(field: Field, value: NetworkDraft[Field]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const errorText = (field: keyof NetworkDraft) => errors[field] ? t(`networkConfig.${errors[field]}`) : undefined;
  const save = (apply: boolean) => {
    const nextErrors = validateDraft(draft, otherTunNames);
    if (Object.keys(nextErrors).length) {
      setErrors(nextErrors);
      setChoosing(false);
      setAdvancedOpen(true);
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    if (!saveConfiguration(network.id, draft)) {
      notify(t('networkConfig.busy'));
      return;
    }
    onOpenChange(false);
    if (apply) {
      notify(t('networkConfig.applying', { name: draft.alias.trim() || draft.name }));
      void applyConfiguration(network.id).then((applied) => {
        if (applied) notify(t('networkConfig.applied', { name: draft.alias.trim() || draft.name }));
      });
    } else {
      const saved = useNetworkStore.getState().networks.find((item) => item.id === network.id)!;
      notify(t(hasPendingConfig(saved) ? 'networkConfig.savedLater' : 'networkConfig.saved'));
    }
  };
  const submit = (event: FormEvent) => {
    event.preventDefault();
    const nextErrors = validateDraft(draft, otherTunNames);
    setErrors(nextErrors);
    if (Object.keys(nextErrors).length) {
      const basicFields = ['alias', 'icon', 'name', 'hostname', 'secret', 'servers'];
      if (Object.keys(nextErrors).some((field) => !basicFields.includes(field))) setAdvancedOpen(true);
      requestAnimationFrame(() => form.current?.querySelector<HTMLElement>('[aria-invalid="true"]')?.focus());
      return;
    }
    const proposed = draftConfig(draft, network.savedConfig);
    if (localChanged && configsEqual(proposed, network.savedConfig)) {
      save(false);
      return;
    }
    if (network.coreState === 'running' && network.runningConfig && !configsEqual(proposed, network.runningConfig)) {
      setChoosing(true);
    } else save(false);
  };
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
        <Button variant="outlined" disabled={busy} autoFocus onClick={() => save(false)}>{t('networkConfig.later')}</Button>
        <Button disabled={busy} onClick={() => save(true)}>{t('networkConfig.applyNow')}</Button>
      </div>
    </div> : <form ref={form} className="network-editor-form" noValidate onSubmit={submit}>
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
        <Button type="submit" disabled={busy || (!changed && !hasPendingConfig(network))}>{t('networkConfig.save')}</Button>
      </div>
    </form>}
  </Dialog>;
}
