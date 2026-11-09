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
  const preview = snapshot?.distribution === 'preview';
  const candidate = snapshot?.candidate;
  const code = error ?? snapshot?.error;
  const percentage = snapshot?.total
    ? Math.min(100, Math.floor((snapshot.downloaded / snapshot.total) * 100))
    : null;
  const status = !snapshot
    ? 'loading'
    : preview
      ? 'preview'
      : !supported
        ? 'unsupported'
        : code && !busy && !candidate
          ? 'failed'
          : phase;
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
      <div className="update-heading">
        <h2>{t('updates.title')}</h2>
        <Button
          variant="outlined"
          icon="refresh"
          disabled={!supported || busy || pending || phase === 'ready'}
          onClick={() => {
            void run({ action: 'check' });
          }}
        >
          {t(phase === 'checking' ? 'updates.checking' : 'updates.check')}
        </Button>
      </div>
      <div className="update-details">
        <p className="update-status" role="status">
          {busy && <Icon name="progress_activity" className="is-spinning" />}
          {t(`updates.status.${status}`, {
            version: candidate?.version,
            progress: percentage === null ? '' : `${percentage}%`,
          })}
        </p>
        {phase === 'downloading' && (
          <progress
            className="update-progress"
            aria-label={t('updates.progress')}
            max={100}
            value={percentage ?? undefined}
          />
        )}
        {code && (
          <p className="update-error" role="alert">
            {t(`updates.errors.${errorKey}`)}
          </p>
        )}
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
        {candidate && supported && (
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
            ) : (
              <Button
                icon={snapshot.distribution === 'installed' ? 'system_update' : 'download'}
                disabled={busy || pending || phase === 'ready'}
                onClick={() => {
                  void run(
                    snapshot.distribution === 'installed'
                      ? { action: 'update', confirmed: false }
                      : { action: 'openZip' },
                  );
                }}
              >
                {t(
                  snapshot.distribution === 'installed'
                    ? 'updates.downloadInstall'
                    : 'updates.downloadZip',
                )}
              </Button>
            )}
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
          </div>
        )}
      </div>
      <div className="update-preferences">
        <div className="update-preference">
          <span>{t('updates.automatic')}</span>
          <Switch
            checked={snapshot?.preferences.automatic ?? true}
            label={t('updates.automatic')}
            disabled={!snapshot || (!supported && !preview) || busy || pending || phase === 'ready'}
            onChange={(value) => change('automatic', value)}
          />
        </div>
        <div className="update-preference">
          <span>{t('updates.prereleases')}</span>
          <Switch
            checked={snapshot?.preferences.prereleases ?? false}
            label={t('updates.prereleases')}
            disabled={!snapshot || (!supported && !preview) || busy || pending || phase === 'ready'}
            onChange={(value) => change('prereleases', value)}
          />
        </div>
      </div>
      <Dialog
        open={phase === 'ready'}
        onOpenChange={(open) => {
          if (!open) void run({ action: 'cancel' });
        }}
        title={t('updates.confirmTitle')}
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
