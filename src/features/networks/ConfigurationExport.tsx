import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, useSnackbar } from '../../components/ui';
import { officialConfiguration } from '../../platform/official-configuration';
import type { Network } from './model';
import { transferError } from './official-configuration';

export function useConfigurationExport() {
  const { t } = useTranslation();
  const notify = useSnackbar();
  // Freeze the chosen saved configuration; polling or later edits cannot silently
  // change the document the user is about to export.
  const [network, setNetwork] = useState<Network | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const save = async () => {
    if (!network || saving) return;
    setSaving(true);
    setError('');
    try {
      if (await officialConfiguration.export(network.id, network.savedConfig)) {
        setNetwork(null);
        notify(t('toml.exported'));
      }
    } catch (error) {
      setError(t(`toml.errors.${transferError(error)}`));
    } finally {
      setSaving(false);
    }
  };
  return {
    openExport: (network: Network) => {
      setNetwork(structuredClone(network));
      setError('');
    },
    exporter: (
      <Dialog
        open={Boolean(network)}
        onOpenChange={(open) => {
          if (!open && !saving) setNetwork(null);
        }}
        title={t('toml.exportTitle')}
        description={t('toml.exportDescription', { name: network?.alias })}
      >
        {error && (
          <p className="configuration-error-text" role="alert">
            {error}
          </p>
        )}
        <div className="network-editor-actions">
          <Button variant="text" disabled={saving} onClick={() => setNetwork(null)}>
            {t('networkConfig.cancel')}
          </Button>
          <Button
            icon="save_alt"
            disabled={saving}
            onClick={() => {
              void save();
            }}
          >
            {t('toml.chooseDestination')}
          </Button>
        </div>
      </Dialog>
    ),
  };
}
