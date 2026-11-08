import { formatBytes } from '../../lib/format-bytes.ts';
import type { TrafficPoint } from '../networks/telemetry.ts';

// Both series share a scale. Missing samples split lines AND fills: each area
// closes against its own time interval, without painting across an unknown gap.
export function trafficChart(points: TrafficPoint[]) {
  const latest = points.at(-1)?.at ?? 0;
  const visible = points.filter((point) => point.at >= latest - 60_000);
  const maximum = Math.max(1024, ...visible.flatMap((point) => [point.download ?? 0, point.upload ?? 0]));
  const scale = 2 ** Math.ceil(Math.log2(maximum));
  const paths = (field: 'download' | 'upload') => {
    const lines: string[] = [], areas: string[] = [];
    let current = '', firstX = '', lastX = '', count = 0;
    const finish = () => {
      if (current) lines.push(current);
      if (count > 1) areas.push(`${current} L${lastX},136.0 L${firstX},136.0 Z`);
      current = ''; count = 0;
    };
    for (const point of visible) {
      const value = point[field];
      if (value === null || !Number.isFinite(value)) { finish(); continue; }
      const x = Math.max(0, 600 - (latest - point.at) / 100).toFixed(1);
      const y = 136 - Math.max(0, value) / scale * 124;
      if (!current) firstX = x;
      lastX = x; count++;
      current += `${current ? ' L' : 'M'}${x},${y.toFixed(1)}`;
    }
    finish();
    return { lines, areas };
  };
  const download = paths('download'), upload = paths('upload');
  const formatted = formatBytes(scale);
  const top = Number(formatted.value);
  return { scale, download: download.lines, upload: upload.lines,
    areas: { download: download.areas, upload: upload.areas },
    axis: { unit: `${formatted.unit}/s`, ticks: [String(top), String(top / 2), '0'] },
  };
}
