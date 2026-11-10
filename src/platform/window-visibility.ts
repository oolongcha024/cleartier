import { platform } from './index';
export const watchWindowVisibility = (changed: (visible: boolean) => void) =>
  platform.watchWindowVisibility(changed);
