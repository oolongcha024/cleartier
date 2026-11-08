import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { isDesktop } from '../platform/client';

// Remote HTTP previews and desktop webviews have different clipboard permissions.
export async function copyText(value: string): Promise<boolean> {
  if (isDesktop()) {
    try {
      await writeText(value);
      return true;
    } catch {
      return false;
    }
  }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch {
    const previousFocus = document.activeElement;
    const input = document.createElement('textarea');
    input.value = value;
    input.style.cssText = 'position:fixed;top:0;left:-9999px;';
    document.body.append(input);
    input.select();
    let copied = false;
    try {
      copied = document.execCommand('copy');
    } catch {
      /* Manual copy remains available. */
    }
    input.remove();
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
    return copied;
  }
}
