// Shared by the settings UI and the design-time Material color generator.
export const themeColors = [
  { id: 'blue', seed: '#3569b0' },
  { id: 'purple', seed: '#7656a8' },
  { id: 'teal', seed: '#006a71' },
  { id: 'green', seed: '#386a5c' },
  { id: 'orange', seed: '#a65d23' },
  { id: 'rose', seed: '#a44872' },
] as const;

export type ThemeColor = typeof themeColors[number]['id'];
export const defaultThemeColor: ThemeColor = 'blue';

export function parseThemeColor(value: string | null): ThemeColor {
  return themeColors.find((color) => color.id === value)?.id ?? defaultThemeColor;
}
