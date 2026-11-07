import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../components/ui';
import { configurationDraft, configsEqual, draftConfig, hasPendingConfig, type DraftErrors, type NetworkDraft } from './configuration';
import { isBusy, type Network } from './model';
import type { SaveMode } from './network-store';
import { useNetworkStore } from './store';

// DOM focus and scroll belong to the editor; this module owns the edit workflow.
export function useNetworkDraft(network: Network, close: () => void, focusError: () => void) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const saveConfiguration = useNetworkStore((state) => state.saveConfiguration);
  const [draft, setDraft] = useState(() => configurationDraft(network));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [choosing, setChoosing] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const changed = draft.alias !== network.alias || draft.icon !== network.icon
    || !configsEqual(draftConfig(draft, network.savedConfig), network.savedConfig);
  const update = <Field extends keyof NetworkDraft>(field: Field, value: NetworkDraft[Field]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
  };
  const save = (mode: SaveMode = 'confirm') => {
    const result = saveConfiguration(network.id, draft, mode);
    if (result.status === 'confirmation-required') { setChoosing(true); return; }
    if (result.status === 'invalid') {
      setErrors(result.errors);
      setChoosing(false);
      const basicFields = ['alias', 'icon', 'name', 'hostname', 'secret', 'servers'];
      if (Object.keys(result.errors).some((field) => !basicFields.includes(field))) setAdvancedOpen(true);
      focusError();
      return;
    }
    if (result.status === 'busy' || result.status === 'missing') { notify(t('networkConfig.busy')); return; }
    close();
    if (result.status === 'saved') {
      notify(t(result.pending ? 'networkConfig.savedLater' : 'networkConfig.saved'));
    } else {
      const name = draft.alias.trim() || draft.name;
      notify(t('networkConfig.applying', { name }));
      void result.completion.then((applied) => {
        notify(t(applied ? 'networkConfig.applied' : 'networkConfig.applyFailed', { name }));
      });
    }
  };
  return {
    draft, errors, update, save, choosing, setChoosing, advancedOpen, setAdvancedOpen,
    busy: isBusy(network), canSave: changed || hasPendingConfig(network),
  };
}
