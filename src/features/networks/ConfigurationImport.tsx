import { useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, TextField, useSnackbar } from '../../components/ui';
import { officialConfiguration } from '../../platform/official-configuration';
import { serverSummary } from './configuration';
import { ConfigurationCompatibility, useCompatibility } from './ConfigurationCompatibility';
import { transferError, type ConfigurationPreview } from './official-configuration';
import { useNetworkStore } from './store';

function ImportPreview({ preview, close }: { preview: ConfigurationPreview; close: () => void }) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const [config, setConfig] = useState(preview.config);
  const [alias, setAlias] = useState(preview.config.name);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const aliasInput = useRef<HTMLInputElement>(null);
  const networks = useNetworkStore((state) => state.networks);
  const importConfiguration = useNetworkStore((state) => state.importConfiguration);
  const { report, checking, error: checkError } = useCompatibility(preview.id, config, true, preview);
  const tunConflict = Boolean(config.tunName) && networks.some((network) => network.savedConfig.tunName.toLowerCase() === config.tunName.toLowerCase());
  const addressConflict = config.ipv4Mode === 'manual' && networks.some((network) => network.savedConfig.ipv4Mode === 'manual' && network.savedConfig.ipv4Address === config.ipv4Address);
  const duplicate = networks.some((network) => network.savedConfig.name === config.name && network.savedConfig.secret === config.secret);
  const save = async () => {
    if (saving || tunConflict || checking || checkError) return;
    setSaving(true); setError('');
    try {
      const result = await importConfiguration(preview.id, config, alias);
      if (result.status !== 'completed') { setError(result.status === 'conflict' ? 'toml.importConflict' : 'configuration.saveFailed'); return; }
      close(); notify(t('toml.imported'));
    } finally { setSaving(false); }
  };
  return <Dialog open onOpenChange={(open) => { if (!open && !saving) close(); }} title={t('toml.previewTitle')}
    className="configuration-transfer" description={t('toml.migration')} initialFocus={aliasInput}>
    <div className="configuration-transfer-body">
      <TextField name="importAlias" label={t('networkConfig.alias')} value={alias} onChange={setAlias} disabled={saving} inputRef={aliasInput} />
      <dl className="configuration-preview-facts">
        <div><dt>{t('networkConfig.name')}</dt><dd>{config.name || '—'}</dd></div>
        <div><dt>{t('networkConfig.hostname')}</dt><dd>{config.hostname || t('networkConfig.hostnamePlaceholder')}</dd></div>
        <div><dt>{t('networkConfig.ipv4Address')}</dt><dd>{config.ipv4Mode === 'manual' ? `${config.ipv4Address}/${config.ipv4Prefix}` : t(`networkConfig.ipv4Modes.${config.ipv4Mode}`)}</dd></div>
        <div><dt>{t('networkConfig.secret')}</dt><dd>{t(config.secret ? 'toml.secretIncluded' : 'toml.secretEmpty')}</dd></div>
        <div className="configuration-preview-servers"><dt>{t('networkConfig.servers')}</dt><dd>{config.servers.length ? config.servers.map(serverSummary).join('\n') : t('toml.noServers')}</dd></div>
      </dl>
      <TextField name="importTunName" label={t('networkConfig.tunName')} value={config.tunName} disabled={saving}
        onChange={(tunName) => setConfig((current) => ({ ...current, tunName }))} error={tunConflict ? t('networkConfig.tunDuplicate') : undefined} />
      {(duplicate || addressConflict) && <p className="configuration-migration-note">{t(duplicate ? 'toml.duplicate' : 'toml.addressConflict')}</p>}
      <ConfigurationCompatibility report={report} error={checkError} checking={checking} />
      {error && <p role="alert" className="configuration-error-text">{t(error)}</p>}
    </div>
    <div className="network-editor-actions"><Button variant="text" disabled={saving} onClick={close}>{t('networkConfig.cancel')}</Button>
      <Button icon="file_download" disabled={saving || tunConflict || checking || checkError} onClick={() => { void save(); }}>
        {t(saving ? 'networkConfig.saving' : duplicate ? 'toml.importAnyway' : 'toml.import')}
      </Button></div>
  </Dialog>;
}

export function useConfigurationImport() {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const [preview, setPreview] = useState<ConfigurationPreview | null>(null);
  const [picking, setPicking] = useState(false);
  const openImport = async () => {
    if (picking) return;
    setPicking(true);
    try { const result = await officialConfiguration.pick(); if (result) setPreview(result); }
    catch (error) { notify(t(`toml.errors.${transferError(error)}`)); }
    finally { setPicking(false); }
  };
  return { openImport, picking, importer: preview && <ImportPreview key={preview.id} preview={preview} close={() => setPreview(null)} /> };
}
