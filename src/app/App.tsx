import { HashRouter } from 'react-router';
import { Tooltip } from '@base-ui/react/tooltip';
import { SnackbarProvider } from '../components/ui';
import { ThemeProvider } from '../theme/theme';
import { AppShell } from './AppShell';
import { AppRoutes } from './routes';

export default function App() {
  return <ThemeProvider><Tooltip.Provider><SnackbarProvider><HashRouter>
    <AppShell><AppRoutes /></AppShell>
  </HashRouter></SnackbarProvider></Tooltip.Provider></ThemeProvider>;
}
