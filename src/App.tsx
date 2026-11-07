import { lazy, Suspense, useState } from 'react';
import { HashRouter, NavLink, Navigate, Route, Routes, useLocation } from 'react-router';
import { Tooltip } from '@base-ui/react/tooltip';
import { useTranslation } from 'react-i18next';
import { Chip, Icon, IconButton, Select, SnackbarProvider } from './components/ui';
import { useNetworkStore } from './features/networks/store';
import { isConnected } from './features/networks/model';
import { ThemeProvider, useTheme, type ThemePreference } from './theme/theme';
import { version } from '../package.json';

const Dashboard = lazy(async () => ({ default: (await import('./features/dashboard/Dashboard')).Dashboard }));
const NetworksPage = lazy(async () => ({ default: (await import('./features/networks/NetworksPage')).NetworksPage }));

const navigation = [
  { id: 'dashboard', icon: 'space_dashboard', path: '/' },
  { id: 'networks', icon: 'hub', path: '/networks' },
  { id: 'devices', icon: 'devices', path: '/devices' },
  { id: 'connections', icon: 'lan', path: '/connections' },
  { id: 'diagnostics', icon: 'monitor_heart', path: '/diagnostics' },
] as const;

function Appearance() {
  const { t } = useTranslation();
  const { preference, setPreference } = useTheme();
  return <section className="card settings-card">
    <h2>{t('settings.appearance')}</h2>
    <div className="settings-row"><span>{t('settings.theme')}</span>
      <Select label={t('settings.theme')} value={preference} onChange={(value) => setPreference(value as ThemePreference)}
        options={(['system', 'light', 'dark'] as const).map((value) => ({ value, label: t(`app.${value}`) }))} />
    </div>
  </section>;
}

function PlannedPage({ icon }: { icon: string }) {
  const { t } = useTranslation();
  return <section className="planned-page">
    <div className="empty-icon"><Icon name={icon} /></div>
    <h2>{t('dashboard.pendingTitle')}</h2>
    <p>{t('dashboard.pendingBody')}</p>
    <NavLink to="/" className="button button--tonal"><Icon name="arrow_back" />{t('dashboard.back')}</NavLink>
  </section>;
}

function Shell() {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { dark, setPreference } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const networks = useNetworkStore((state) => state.networks);
  const connected = networks.filter(isConnected).length;
  const currentPage = navigation.find((item) => item.path === pathname)?.id ?? 'settings';

  return <div className={`app-shell ${collapsed ? 'app-shell--collapsed' : ''}`}>
    <a href="#main-content" className="skip-link" onClick={(event) => {
      event.preventDefault();
      document.getElementById('main-content')?.focus();
    }}>{t('app.skip')}</a>
    <aside className="sidebar">
      <NavLink to="/" className="brand" aria-label={t('app.name')}>
        <span className="brand-mark"><span className="brand-logo" aria-hidden="true" /></span><span className="brand-name">ClearTier<span className="brand-period">.</span></span>
      </NavLink>
      <div className="sidebar-navigation" id="sidebar-navigation">
        <nav aria-label={t('app.navigation')}>
          {navigation.map((item) => <NavLink key={item.id} to={item.path} end={item.path === '/'}
            aria-label={t(`nav.${item.id}`)}
            title={collapsed ? t(`nav.${item.id}`) : undefined} className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`}>
            <Icon name={item.icon} /><span className="nav-item-label">{t(`nav.${item.id}`)}</span>
            {item.id === 'networks' && <span className="nav-badge">{networks.length}</span>}
          </NavLink>)}
        </nav>
      </div>
      <div className="sidebar-bottom">
        <div className="sidebar-status"><span className={`status-dot ${connected ? 'status-dot--success' : ''}`} />
          <span>{t(connected ? 'dashboard.networksOnline' : 'dashboard.allOffline', { count: connected })}</span>
        </div>
        <NavLink to="/settings" aria-label={t('nav.settings')} className={({ isActive }) => `nav-item ${isActive ? 'nav-item--active' : ''}`} title={collapsed ? t('nav.settings') : undefined}>
          <Icon name="settings" /><span className="nav-item-label">{t('nav.settings')}</span>
        </NavLink>
        <div className="sidebar-footer">
          <IconButton icon={collapsed ? 'left_panel_open' : 'left_panel_close'} label={t(collapsed ? 'app.expand' : 'app.collapse')}
            aria-expanded={!collapsed} aria-controls="sidebar-navigation" onClick={() => setCollapsed(!collapsed)} />
          <span>ClearTier <span className="version">{version}</span></span>
        </div>
      </div>
    </aside>
    <main className="main-content" id="main-content" tabIndex={-1}>
      <header className="page-header"><h1 key={currentPage} className="page-title">{t(`nav.${currentPage}`)}</h1>
        <div className="header-actions"><Chip dot>{t('app.demo')}</Chip>
          <IconButton icon={dark ? 'light_mode' : 'dark_mode'} label={t('app.theme')} onClick={() => setPreference(dark ? 'light' : 'dark')} />
        </div>
      </header>
      <Suspense fallback={<div className="page-loading" role="status">{t('app.loading')}</div>}><div key={pathname} className="page-view"><Routes>
        <Route path="/" element={<Dashboard />} />
        <Route path="/networks" element={<NetworksPage />} />
        {navigation.slice(1).filter((item) => item.id !== 'networks').map((item) => <Route key={item.id} path={item.path} element={<PlannedPage icon={item.icon} />} />)}
        <Route path="/settings" element={<Appearance />} />
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes></div></Suspense>
      <footer className="page-footer"><Icon name="science" /><span>{t('app.demoDescription')}</span></footer>
    </main>
  </div>;
}

export default function App() {
  return <ThemeProvider><Tooltip.Provider><SnackbarProvider><HashRouter><Shell /></HashRouter></SnackbarProvider></Tooltip.Provider></ThemeProvider>;
}
