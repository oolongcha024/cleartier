import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Icon } from '../../components/ui';
import { officialConfiguration } from '../../platform/official-configuration';
import type { NetworkConfig } from './model';
import type { ConfigurationPreview } from './official-configuration';

export function useCompatibility(id: string, config: NetworkConfig, enabled: boolean, initial?: ConfigurationPreview) {
  const [result, setResult] = useState<{ report?: ConfigurationPreview; error: boolean; checking: boolean }>({ report: initial, error: false, checking: enabled });
  useEffect(() => {
    if (!enabled) return;
    let active = true;
    setResult((current) => ({ ...current, checking: true, error: false }));
    const timer = setTimeout(() => {
      void officialConfiguration.inspect(id, config).then((report) => {
        if (active) setResult({ report, error: false, checking: false });
      }, () => { if (active) setResult((current) => ({ ...current, error: true, checking: false })); });
    }, 150);
    return () => { active = false; clearTimeout(timer); };
  }, [id, config, enabled]);
  return result;
}

export function ConfigurationCompatibility({ report, error = false, checking = false }: {
  report?: ConfigurationPreview; error?: boolean; checking?: boolean;
}) {
  const { t } = useTranslation();
  return <div className="configuration-compatibility" aria-busy={checking}>
    {error ? <p className="configuration-error-text" role="alert">{t('toml.checkFailed')}</p>
      : report && <>
        <div className={`compatibility-status ${report.issues.length ? 'compatibility-status--blocked' : ''}`} role="status">
          <Icon name={report.issues.length ? 'error_outline' : 'check_circle'} />
          <span>{t(report.issues.length ? 'toml.blocked' : 'toml.compatible')}</span>
        </div>
        {report.issues.length > 0 && <ul className="compatibility-issues">{report.issues.map((issue, index) => <li key={`${issue.path}-${index}`}>
          <code>{issue.path || t('toml.document')}</code><span>{t(`toml.issues.${issue.code}`, { defaultValue: t('toml.issues.invalid') })}</span>
        </li>)}</ul>}
        {report.preservedFields.length > 0 && <details className="compatibility-preserved">
          <summary>{t('toml.preserved', { count: report.preservedFields.length })}</summary>
          <ul>{report.preservedFields.map((field) => <li key={field}><code>{field}</code></li>)}</ul>
        </details>}
      </>}
  </div>;
}
