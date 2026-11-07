import { useState, type ReactNode } from 'react';
import { NavLink, useLocation } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Chip, Icon, IconButton } from '../components/ui';
import { useNetworkStore } from '../features/networks/store';
import { isConnected } from '../features/networks/model';
import { useTheme } from '../theme/theme';
import { navigation, pageId } from './routes';
import { version } from '../../package.json';

export function AppShell({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const { pathname } = useLocation();
  const { dark, setPreference } = useTheme();
  const [collapsed, setCollapsed] = useState(false);
  const networkCount = useNetworkStore((state) => state.networks.length);
  const connected = useNetworkStore((state) => state.networks.filter(isConnected).length);
  const currentPage = pageId(pathname);

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
            {item.id === 'networks' && <span className="nav-badge">{networkCount}</span>}
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
      <div key={pathname} className="page-view">{children}</div>
      <footer className="page-footer"><Icon name="science" /><span>{t('app.demoDescription')}</span></footer>
    </main>
  </div>;
}

