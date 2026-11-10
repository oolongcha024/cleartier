import { platform } from './index';
import type { DesktopUpdate } from './contracts';
export type {
  DesktopPreferences,
  DesktopStatus,
  DesktopUpdate,
  DiagnosticReport,
} from './contracts';
export const readDesktop = () => platform.desktop.read();
export const updateDesktop = (update: DesktopUpdate) => platform.desktop.update(update);
export const watchDesktop = (refresh: () => void) => platform.desktop.watch(refresh);
export const respondDesktop = (requestId: number, choice: 'cancel' | 'background' | 'exit') =>
  platform.desktop.respond(requestId, choice);
export const exitDesktop = () => platform.desktop.exit();
export const readDiagnostics = () => platform.desktop.readDiagnostics();
export const exportDiagnostics = () => platform.desktop.exportDiagnostics();
export const openLogs = () => platform.desktop.openLogs();
