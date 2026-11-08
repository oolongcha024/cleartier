import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../components/ui';
import { configurationDraft, configsEqual, draftConfig, hasPendingConfig, validateDraft, type DraftErrors, type NetworkDraft } from './configuration';
import { isBusy, type Network } from './model';
import type { SaveMode } from './network-store';
import { useNetworkStore } from './store';

// The draft survives failed disk writes. Closing and acknowledging success only
// happen after the configuration repository has accepted the write.
export function useNetworkDraft(network: Network, creating: boolean, close: () => void, focusError: () => void) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const saveConfiguration = useNetworkStore((state) => state.saveConfiguration);
  const networks = useNetworkStore((state) => state.networks);
  const [draft, setDraft] = useState(() => configurationDraft(network));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [choosing, setChoosing] = useState(false);
  const [duplicate, setDuplicate] = useState<Network | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const changed = draft.alias !== network.alias || draft.icon !== network.icon
    || !configsEqual(draftConfig(draft, network.savedConfig), network.savedConfig);
  const update = <Field extends keyof NetworkDraft>(field: Field, value: NetworkDraft[Field]) => {
    setDraft((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: undefined }));
    setSaveError(false);
  };
  const requestClose = () => {
    if (saving) return;
    if (changed) setDiscarding(true);
    else close();
  };
  const save = async (mode: SaveMode = 'confirm', allowDuplicate = false) => {
    if (saving) return;
    const validation = validateDraft(draft, networks.filter((item) => item.id !== network.id).map((item) => item.savedConfig.tunName));
    if (Object.keys(validation).length) {
      setErrors(validation); setChoosing(false); setDuplicate(null);
      const basicFields = ['alias', 'icon', 'name', 'hostname', 'secret', 'servers'];
      if (Object.keys(validation).some((field) => !basicFields.includes(field))) setAdvancedOpen(true);
      focusError(); return;
    }
    if (creating && !allowDuplicate) {
      const existing = networks.find((item) => item.savedConfig.name === draft.name && item.savedConfig.secret === draft.secret);
      if (existing) { setDuplicate(existing); return; }
    }
    setSaving(true); setSaveError(false);
    try {
      const result = await saveConfiguration(network.id, draft, mode, creating);
      if (result.status === 'confirmation-required') { setChoosing(true); return; }
      if (result.status === 'invalid') { setErrors(result.errors); focusError(); return; }
      if (result.status === 'storage-error') { setSaveError(true); setChoosing(false); setDuplicate(null); return; }
      if (result.status === 'busy' || result.status === 'missing' || result.status === 'unsupported') { notify(t('networkConfig.busy')); return; }
      close();
      if (result.status === 'saved') {
        notify(t(result.pending ? 'networkConfig.savedLater' : creating ? 'networkConfig.added' : 'networkConfig.saved'));
      } else if (result.status === 'applying') {
        notify(t('networkConfig.applying', { name: draft.alias.trim() || draft.name }));
        void result.completion.then((applied) => notify(t(applied ? 'networkConfig.applied' : 'networkConfig.applyFailed', { name: draft.alias.trim() || draft.name })));
      }
    } finally { setSaving(false); }
  };
  return { draft, errors, update, save, choosing, setChoosing, duplicate, setDuplicate, discarding, setDiscarding,
    requestClose, saving, saveError, advancedOpen, setAdvancedOpen, busy: saving || isBusy(network),
    canSave: creating || changed || hasPendingConfig(network) };
}
