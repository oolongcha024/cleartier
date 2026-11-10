import { platform } from '../platform';
export async function copyText(value: string): Promise<boolean> {
  try {
    await platform.writeClipboard(value);
    return true;
  } catch {
    return false;
  }
}
