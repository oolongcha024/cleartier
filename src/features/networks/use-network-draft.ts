import { useRef, useState } from 'react';
import { fillInvitation, type Invitation } from '../invitations/invitation';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../components/ui';
import {
  configurationDraft,
  configsEqual,
  draftConfig,
  hasPendingConfig,
  validateDraft,
  type DraftErrors,
  type NetworkDraft,
} from './configuration';
import { isBusy, type Network } from './model';
import { completed, type SaveMode } from './network-store';
import { useNetworkStore } from './store';

// The draft survives failed disk writes. Closing and acknowledging success only
// happen after the configuration repository has accepted the write.
export function useNetworkDraft(
  network: Network,
  creating: boolean,
  close: () => void,
  focusError: () => void,
) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const saveNetwork = useNetworkStore((state) => state.save);
  const create = useNetworkStore((state) => state.create);
  const selectNetwork = useNetworkStore((state) => state.selectNetwork);
  const networks = useNetworkStore((state) => state.networks);
  const [draft, setDraft] = useState(() => configurationDraft(network));
  const [errors, setErrors] = useState<DraftErrors>({});
  const [choosing, setChoosing] = useState(false);
  const [duplicate, setDuplicate] = useState<Network | null>(null);
  const [discarding, setDiscarding] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const lastInvitationName = useRef<string | undefined>(undefined);
  const acceptInvitation = (invitation: Invitation) => {
    const previous = lastInvitationName.current;
    lastInvitationName.current = invitation.displayName?.trim() || invitation.name;
    setDraft((current) => fillInvitation(current, invitation, previous));
    setErrors((current) => ({
      ...current,
      name: undefined,
      secret: undefined,
      servers: undefined,
    }));
    setSaveError(false);
  };
  const changed =
    draft.alias !== network.alias ||
    draft.icon !== network.icon ||
    !configsEqual(draftConfig(draft, network.savedConfig), network.savedConfig);
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
  const openExisting = async () => {
    if (!duplicate || saving) return false;
    setSaving(true);
    setSaveError(false);
    try {
      if (!completed(await selectNetwork(duplicate.id))) {
        setSaveError(true);
        return false;
      }
      close();
      return true;
    } finally {
      setSaving(false);
    }
  };
  const save = async (mode: SaveMode = 'confirm', allowDuplicate = false) => {
    if (saving) return;
    const validation = validateDraft(
      draft,
      networks.filter((item) => item.id !== network.id).map((item) => item.savedConfig.tunName),
      network.savedConfig,
    );
    if (Object.keys(validation).length) {
      setErrors(validation);
      setChoosing(false);
      setDuplicate(null);
      const basicFields = ['alias', 'icon', 'name', 'hostname', 'secret', 'servers'];
      if (Object.keys(validation).some((field) => !basicFields.includes(field)))
        setAdvancedOpen(true);
      focusError();
      return;
    }
    if (creating && !allowDuplicate) {
      const existing = networks.find(
        (item) => item.savedConfig.name === draft.name && item.savedConfig.secret === draft.secret,
      );
      if (existing) {
        setDuplicate(existing);
        return;
      }
    }
    setSaving(true);
    setSaveError(false);
    try {
      const result = await (creating
        ? create(network.id, draft)
        : saveNetwork(network.id, draft, mode));
      if (result.status === 'confirmation-required') {
        setChoosing(true);
        return;
      }
      if (result.status === 'invalid') {
        setErrors(result.errors);
        focusError();
        return;
      }
      if (result.status === 'storage-error') {
        setSaveError(true);
        setChoosing(false);
        setDuplicate(null);
        return;
      }
      if (result.status !== 'saved' && result.status !== 'applying') {
        notify(t(result.status === 'stale' ? 'networkConfig.stale' : 'networkConfig.busy'));
        return;
      }
      close();
      if (result.status === 'saved') {
        notify(
          t(
            result.pending
              ? 'networkConfig.savedLater'
              : creating
                ? 'networkConfig.added'
                : 'networkConfig.saved',
          ),
        );
      } else if (result.status === 'applying') {
        notify(t('networkConfig.applying', { name: draft.alias.trim() || draft.name }));
        void result.completion.then((applied) =>
          notify(
            t(completed(applied) ? 'networkConfig.applied' : 'networkConfig.applyFailed', {
              name: draft.alias.trim() || draft.name,
            }),
          ),
        );
      }
    } finally {
      setSaving(false);
    }
  };
  return {
    draft,
    errors,
    update,
    acceptInvitation,
    save,
    openExisting,
    choosing,
    setChoosing,
    duplicate,
    setDuplicate,
    discarding,
    setDiscarding,
    requestClose,
    saving,
    saveError,
    advancedOpen,
    setAdvancedOpen,
    busy: saving || isBusy(network),
    canSave: creating || changed || hasPendingConfig(network),
  };
}
