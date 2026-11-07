const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB', 'EiB'] as const;

export function formatBytes(bytes: number | undefined): { value: string; unit: string } {
  if (bytes === undefined || !Number.isFinite(bytes) || bytes < 0) return { value: '—', unit: '' };
  let index = bytes < 1024 ? 0 : Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  // Promote rounded boundary values instead of displaying "1024.00 KiB".
  if (index > 0 && index < units.length - 1 && Math.round(bytes / 1024 ** index * 100) / 100 >= 1024) index++;
  return { value: index === 0 ? Math.floor(bytes).toString() : (bytes / 1024 ** index).toFixed(2), unit: units[index] };
}
