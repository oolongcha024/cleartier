import {
  addTransitionType,
  createContext,
  startTransition,
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
const systemSchemeQuery = '(prefers-color-scheme: dark)';

function changeTheme(update: () => void) {
  if (
    !document.startViewTransition ||
    !CSS.supports('selector(:active-view-transition-type(theme))') ||
    !CSS.supports('view-transition-name: match-element') ||
    !CSS.supports('selector(::view-transition-old(.theme-backdrop))') ||
    matchMedia('(prefers-reduced-motion: reduce)').matches
  ) {
    update();
    return;
  }
  startTransition(() => {
    addTransitionType('theme');
    update();
  });
}

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
  const root = document.documentElement;
  const theme = dark ? 'dark' : 'light';
  if (root.dataset.theme === theme && root.dataset.themeColor === color) return;

  root.setAttribute('data-theme-committing', '');
  try {
    root.dataset.theme = theme;
    root.dataset.themeColor = color;
    root.style.colorScheme = theme;
    // Reading document animations flushes styles while CSS transitions are suppressed.
    document.getAnimations();
  } finally {
    root.removeAttribute('data-theme-committing');
  }
}

const ThemeContext = createContext({
  preference: defaultThemePreference as ThemePreference,
  dark: false,
  setPreference: (_value: ThemePreference) => {},
  toggleTheme: () => {},
  color: defaultThemeColor,
  setColor: (_value: ThemeColor) => {},
});

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [preference, setPreference] = useState(readPreference);
  const [color, setColor] = useState(readColor);
  const [systemDark, setSystemDark] = useState(() => matchMedia(systemSchemeQuery).matches);
  const dark = preference === 'system' ? systemDark : preference === 'dark';

  useLayoutEffect(() => {
    applyColors(dark, color);
  }, [dark, color]);

  useEffect(() => {
    const media = matchMedia(systemSchemeQuery);
    const listener = () => {
      const matches = media.matches;
      changeTheme(() => setSystemDark(matches));
    };
    media.addEventListener('change', listener);
    return () => media.removeEventListener('change', listener);
  }, []);

  // Persist the committed preference even if the page closes during the fade.
  useLayoutEffect(() => {
    try {
      localStorage.setItem(colorStorageKey, color);
    } catch {
      /* Nonessential preference. */
    }
  }, [color]);
  useLayoutEffect(() => {
    try {
      localStorage.setItem(storageKey, preference);
    } catch {
      /* Nonessential preference. */
    }
  }, [preference]);
  return (
    <ThemeContext
      value={{
        preference,
        dark,
        color,
        setPreference: (value) => changeTheme(() => setPreference(value)),
        setColor: (value) => changeTheme(() => setColor(value)),
        toggleTheme: () => {
          const systemIsDark = matchMedia(systemSchemeQuery).matches;
          changeTheme(() => {
            setPreference((current) => {
              const isDark = current === 'system' ? systemIsDark : current === 'dark';
              return isDark ? 'light' : 'dark';
            });
          });
        },
      }}
    >
      {children}
    </ThemeContext>
  );
}
export const useTheme = () => useContext(ThemeContext);
