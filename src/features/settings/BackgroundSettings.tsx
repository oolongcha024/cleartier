import { useTranslation } from 'react-i18next';
import { Button, Select, Switch } from '../../components/ui';
import { useDesktopStore } from '../desktop/desktop-store';
import type { DesktopUpdate } from '../../platform/desktop';

export function BackgroundSettings() {
  const { t } = useTranslation();
  const { status, error, saving, refresh, update } = useDesktopStore();
  const preferences = status?.preferences;
  const disabled =
    !preferences || saving || Boolean(status?.preferenceError) || Boolean(status?.quitting);
  const change = (patch: Partial<DesktopUpdate>) => {
    if (!preferences) return;
    void update({
      closeBehavior: preferences.closeBehavior,
      launchAtLogin: preferences.launchAtLogin,
      autoRecover: preferences.autoRecover,
      ...patch,
    });
  };
  return (
    <section className="card settings-card">
      <h2>{t('desktop.settingsTitle')}</h2>
      {(error || status?.preferenceError) && (
        <div className="settings-notice" role="alert">
          <span>{t('desktop.settingsFailed')}</span>
          <Button
            variant="text"
            disabled={saving}
            onClick={() => {
              void refresh();
            }}
          >
            {t('connection.refresh')}
          </Button>
        </div>
      )}
      {status && !status.trayAvailable && (
        <p className="settings-notice" role="status">
          {t('desktop.trayUnavailable')}
        </p>
      )}
      {status?.autostartError && (
        <p className="settings-notice" role="status">
          {t('desktop.autostartUnavailable')}
        </p>
      )}
      <div className="settings-row">
        <span>{t('desktop.closeBehavior')}</span>
        <Select
          disabled={disabled}
          label={t('desktop.closeBehavior')}
          value={preferences?.closeBehavior ?? 'background'}
          onChange={(closeBehavior) =>
            change({ closeBehavior: closeBehavior as DesktopUpdate['closeBehavior'] })
          }
          options={(['background', 'exit'] as const).map((value) => ({
            value,
            label: t(`desktop.closeOptions.${value}`),
          }))}
        />
      </div>
      <div className="settings-row">
        <span>{t('desktop.launchAtLogin')}</span>
        <Switch
          checked={preferences?.launchAtLogin ?? false}
          label={t('desktop.launchAtLogin')}
          disabled={disabled || Boolean(status?.autostartError)}
          onChange={(launchAtLogin) => change({ launchAtLogin })}
        />
      </div>
      <div className="settings-row">
        <span>{t('desktop.autoRecover')}</span>
        <Switch
          checked={preferences?.autoRecover ?? true}
          label={t('desktop.autoRecover')}
          disabled={disabled}
          onChange={(autoRecover) => change({ autoRecover })}
        />
      </div>
    </section>
  );
}
