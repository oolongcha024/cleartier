import { createContext, useContext, useEffect, useLayoutEffect, useState, type ReactNode } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
const storageKey = 'cleartier.theme';

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'dark') return value;
  } catch { /* Preview also works when browser storage is unavailable. */ }
  return 'system';
}

function applyColors(dark: boolean) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

const ThemeContext = createContext({
  preference: 'system' as ThemePreference, dark: false,
  setPreference: (_value: ThemePreference) => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference);
  const [systemDark, setSystemDark] = useState(() => matchMedia('(prefers-color-scheme: dark)').matches);
  const dark = preference === 'system' ? systemDark : preference === 'dark';

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setSystemDark(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useLayoutEffect(() => { applyColors(dark); }, [dark]);
  useEffect(() => {
    try { localStorage.setItem(storageKey, preference); } catch { /* Nonessential preference. */ }
  }, [preference]);
  return <ThemeContext value={{ preference, dark, setPreference }}>{children}</ThemeContext>;
}
export const useTheme = () => useContext(ThemeContext);
