import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useState,
  type ReactNode,
} from 'react';
import { defaultThemeColor, parseThemeColor, type ThemeColor } from './palettes';

export type ThemePreference = 'system' | 'light' | 'dark';
const defaultThemePreference: ThemePreference = 'system';
const storageKey = 'cleartier.theme';
const colorStorageKey = 'cleartier.themeColor';

function readColor(): ThemeColor {
  try {
    return parseThemeColor(localStorage.getItem(colorStorageKey));
  } catch {
    return defaultThemeColor;
  }
}

function readPreference(): ThemePreference {
  try {
    const value = localStorage.getItem(storageKey);
    if (value === 'light' || value === 'dark') return value;
  } catch {
    /* Nonessential preference. */
  }
  return defaultThemePreference;
}

function applyColors(dark: boolean, color: ThemeColor) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  document.documentElement.dataset.themeColor = color;
  document.documentElement.style.colorScheme = dark ? 'dark' : 'light';
}

const ThemeContext = createContext({
  preference: defaultThemePreference as ThemePreference,
  dark: false,
  setPreference: (_value: ThemePreference) => {},
  color: defaultThemeColor,
  setColor: (_value: ThemeColor) => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference);
  const [color, setColor] = useState(readColor);
  const [systemDark, setSystemDark] = useState(
    () => matchMedia('(prefers-color-scheme: dark)').matches,
  );
  const dark = preference === 'system' ? systemDark : preference === 'dark';

  useEffect(() => {
    const media = matchMedia('(prefers-color-scheme: dark)');
    const listener = () => setSystemDark(media.matches);
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);
  useLayoutEffect(() => {
    applyColors(dark, color);
  }, [dark, color]);
  useEffect(() => {
    try {
      localStorage.setItem(colorStorageKey, color);
    } catch {
      /* Nonessential preference. */
    }
  }, [color]);
  useEffect(() => {
    try {
      localStorage.setItem(storageKey, preference);
    } catch {
      /* Nonessential preference. */
    }
  }, [preference]);
  return (
    <ThemeContext value={{ preference, dark, setPreference, color, setColor }}>
      {children}
    </ThemeContext>
  );
}
export const useTheme = () => useContext(ThemeContext);
