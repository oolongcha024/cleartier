import { HashRouter } from 'react-router';
import { Tooltip } from '@base-ui/react/tooltip';
import { SnackbarProvider } from '../components/ui';
import { ThemeProvider } from '../theme/theme';
import { AppShell } from './AppShell';
import { AppRoutes } from './routes';
import { NetworkLifecycle } from '../features/networks/NetworkLifecycle';
import { DesktopLifecycle } from '../features/desktop/DesktopLifecycle';
import { UpdateLifecycle } from '../features/updates/UpdateLifecycle';

export default function App() {
  return (
    <ThemeProvider>
      <Tooltip.Provider>
        <SnackbarProvider>
          <HashRouter>
            <NetworkLifecycle />
            <UpdateLifecycle />
            <AppShell>
              <AppRoutes />
            </AppShell>
            <DesktopLifecycle />
          </HashRouter>
        </SnackbarProvider>
      </Tooltip.Provider>
    </ThemeProvider>
  );
}
