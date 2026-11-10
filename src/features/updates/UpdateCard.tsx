import { useTranslation } from 'react-i18next';
import { Button, Card, Dialog, Icon, Switch } from '../../components/ui';
import { useUpdates } from './store';
import './updates.css';

export function UpdateCard() {
  const { t } = useTranslation();
  const { snapshot, run, pending, error } = useUpdates();
  const phase = snapshot?.phase ?? 'idle';
  const busy = ['checking', 'downloading', 'installing'].includes(phase);
  const supported = snapshot?.distribution === 'installed' || snapshot?.distribution === 'portable';
  const candidate = snapshot?.candidate;
  const code = error ?? snapshot?.error;
  const percentage = snapshot?.total
    ? Math.max(0, Math.min(100, Math.floor((snapshot.downloaded / snapshot.total) * 100)))
    : null;
  const status = !snapshot
    ? 'loading'
    : !supported
      ? 'unsupported'
      : code && !busy && !candidate
        ? 'failed'
        : phase;
  const preferencesDisabled = !snapshot || !supported || busy || pending || phase === 'ready';
  const statusIcon =
    status === 'failed'
      ? 'error_outline'
      : status === 'current'
        ? 'check_circle'
        : status === 'downloading'
          ? 'download'
          : status === 'available' || status === 'ready'
            ? 'system_update'
            : busy
              ? 'progress_activity'
              : 'update';
  const change = (key: 'automatic' | 'prereleases', value: boolean) => {
    if (snapshot)
      void run({ action: 'configure', preferences: { ...snapshot.preferences, [key]: value } });
  };
  const errorKey =
    code &&
    [
      'network',
      'access',
      'metadata',
      'signature',
      'storage',
      'rateLimited',
      'cleanup',
      'install',
      'open',
      'busy',
      'portable',
      'unavailable',
    ].includes(code)
      ? code
      : 'read';
  return (
    <Card className="update-card">
      <h2>{t('updates.title')}</h2>
      <div className="update-summary">
        <span
          className={`update-status-icon ${status === 'failed' ? 'update-status-icon--error' : ''}`}
        >
          <Icon
            name={statusIcon}
            className={busy && phase !== 'downloading' ? 'is-spinning' : ''}
          />
        </span>
        <div className="update-details">
          <p className="update-status" role="status">
            {t(`updates.status.${status}`, { version: candidate?.version })}
          </p>
          {snapshot?.lastChecked && (
            <time
              className="update-last-check"
              dateTime={new Date(snapshot.lastChecked * 1000).toISOString()}
            >
              {t('updates.lastChecked', {
                time: new Date(snapshot.lastChecked * 1000).toLocaleString('zh-CN'),
              })}
            </time>
          )}
        </div>
        <div className="update-actions">
          {phase === 'downloading' ? (
            <Button
              variant="text"
              onClick={() => {
                void run({ action: 'cancel' });
              }}
            >
              {t('updates.cancel')}
            </Button>
          ) : candidate && supported ? (
            <Button
              icon={snapshot.distribution === 'installed' ? 'download' : 'open_in_new'}
              disabled={busy || pending || phase === 'ready'}
              onClick={() => {
                void run(
                  code === 'unavailable'
                    ? { action: 'check' }
                    : snapshot.distribution === 'installed'
                      ? { action: 'update', confirmed: false }
                      : { action: 'openZip' },
                );
              }}
            >
              {t(
                code === 'unavailable'
                  ? 'updates.retryCheck'
                  : snapshot.distribution === 'installed'
                    ? code && ['network', 'signature', 'metadata'].includes(code)
                      ? 'updates.retryDownload'
                      : 'updates.downloadInstall'
                    : 'updates.downloadZip',
              )}
            </Button>
          ) : (
            <Button
              variant="outlined"
              icon="refresh"
              disabled={!supported || busy || pending}
              onClick={() => {
                void run({ action: 'check' });
              }}
            >
              {t(
                phase === 'checking'
                  ? 'updates.checking'
                  : code
                    ? 'updates.retryCheck'
                    : 'updates.check',
              )}
            </Button>
          )}
          {candidate && supported && (
            <Button
              variant="text"
              icon="open_in_new"
              disabled={phase === 'installing'}
              onClick={() => {
                void run({ action: 'openRelease' });
              }}
            >
              {t('updates.notes')}
            </Button>
          )}
        </div>
      </div>
      {phase === 'downloading' && (
        <div className="update-download">
          <div
            className={`update-progress ${percentage === null ? 'update-progress--indeterminate' : ''}`}
            role="progressbar"
            aria-label={t('updates.progress')}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percentage ?? undefined}
            data-complete={percentage === 100 || undefined}
          >
            <span
              className="update-progress-fill"
              style={{ width: percentage === null ? undefined : `${percentage}%` }}
            />
          </div>
          {percentage !== null && (
            <span className="update-percentage" aria-hidden="true">
              {percentage}%
            </span>
          )}
        </div>
      )}
      {code && phase !== 'ready' && (
        <div className="update-feedback">
          <p className="update-error" role="alert">
            {t(`updates.errors.${errorKey}`)}
          </p>
          {code === 'rateLimited' && snapshot?.retryAt && (
            <time
              className="update-last-check"
              dateTime={new Date(snapshot.retryAt * 1000).toISOString()}
            >
              {t('updates.retryAt', {
                time: new Date(snapshot.retryAt * 1000).toLocaleString('zh-CN'),
              })}
            </time>
          )}
        </div>
      )}
      <div className="update-preferences">
        <label className="update-preference" data-disabled={preferencesDisabled || undefined}>
          <span>{t('updates.automatic')}</span>
          <Switch
            checked={snapshot?.preferences.automatic ?? true}
            label={t('updates.automatic')}
            disabled={preferencesDisabled}
            onChange={(value) => change('automatic', value)}
          />
        </label>
        <label className="update-preference" data-disabled={preferencesDisabled || undefined}>
          <span>{t('updates.prereleases')}</span>
          <Switch
            checked={snapshot?.preferences.prereleases ?? false}
            label={t('updates.prereleases')}
            disabled={preferencesDisabled}
            onChange={(value) => change('prereleases', value)}
          />
        </label>
      </div>
      <Dialog
        className="update-dialog"
        open={phase === 'ready'}
        onOpenChange={(open) => {
          if (!open && !pending) void run({ action: 'cancel' });
        }}
        title={t('updates.confirmTitle', { version: candidate?.version })}
        description={t('updates.confirmDescription')}
      >
        {code && (
          <p className="update-error" role="alert">
            {t(`updates.errors.${errorKey}`)}
          </p>
        )}
        <div className="update-dialog-actions">
          <Button
            variant="text"
            disabled={pending}
            onClick={() => {
              void run({ action: 'cancel' });
            }}
          >
            {t('updates.later')}
          </Button>
          <Button
            variant="text"
            disabled={pending}
            onClick={() => {
              void run({ action: 'update', confirmed: true });
            }}
          >
            {t('updates.install')}
          </Button>
        </div>
      </Dialog>
    </Card>
  );
}
