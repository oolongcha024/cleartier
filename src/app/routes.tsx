import { Navigate, Route, Routes } from 'react-router';
import { Dashboard } from '../features/dashboard/Dashboard';
import { NetworksPage } from '../features/networks/NetworksPage';
import { SettingsPage } from '../features/settings/SettingsPage';
import { AboutPage } from '../features/about/AboutPage';

// Lightweight desktop pages are ready with the app. Route changes never wait
// for page code; asynchronous data belongs to the feature that displays it.

export const navigation = [
  { id: 'dashboard', icon: 'space_dashboard', path: '/' },
  { id: 'networks', icon: 'hub', path: '/networks' },
] as const;

export function pageId(pathname: string) {
  return pathname === '/settings/about' ? 'about'
    : navigation.find((item) => item.path === pathname)?.id ?? 'settings';
}

export function AppRoutes() {
  return <Routes>
    <Route path="/" element={<Dashboard />} />
    <Route path="/networks" element={<NetworksPage />} />
    <Route path="/settings" element={<SettingsPage />} />
    <Route path="/settings/about" element={<AboutPage />} />
    <Route path="*" element={<Navigate to="/" replace />} />
  </Routes>;
}
