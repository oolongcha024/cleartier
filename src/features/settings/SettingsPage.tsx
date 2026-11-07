import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Icon, Select } from '../../components/ui';
import { useTheme, type ThemePreference } from '../../theme/theme';
import { themeColors, type ThemeColor } from '../../theme/palettes';

export function SettingsPage() {
  const { t } = useTranslation();
  const { preference, setPreference, color, setColor } = useTheme();
  return <div className="settings-page"><section className="card settings-card">
    <h2>{t('settings.appearance')}</h2>
    <div className="settings-row"><span>{t('settings.theme')}</span>
      <Select label={t('settings.theme')} value={preference} onChange={(value) => setPreference(value as ThemePreference)}
        options={(['system', 'light', 'dark'] as const).map((value) => ({ value, label: t(`app.${value}`) }))} />
    </div>
    <div className="settings-row"><span>{t('settings.themeColor')}</span>
      <Select label={t('settings.themeColor')} value={color} onChange={(value) => setColor(value as ThemeColor)}
        options={themeColors.map(({ id }) => ({ value: id, label: t(`settings.colors.${id}`),
          leading: <span className="theme-color-swatch" data-color={id} aria-hidden="true" /> }))} />
    </div>
  </section>
    <Link to="/settings/about" className="card settings-about-link">
      <Icon name="info" /><span>{t('settings.about')}</span><Icon name="chevron_right" />
    </Link>
  </div>;
}

