import type { TrafficPoint } from '../networks/telemetry.ts';

// Both series share a scale. Missing samples split paths; zero remains a real
// baseline point. Time positions stay correct through gaps and focus refreshes.
export function trafficChart(points: TrafficPoint[]) {
  const latest = points.at(-1)?.at ?? 0;
  const visible = points.filter((point) => point.at >= latest - 60_000);
  const maximum = Math.max(1024, ...visible.flatMap((point) => [point.download ?? 0, point.upload ?? 0]));
  const scale = 2 ** Math.ceil(Math.log2(maximum));
  const paths = (field: 'download' | 'upload') => {
    const segments: string[] = [];
    let current = '';
    for (const point of visible) {
      const value = point[field];
      if (value === null || !Number.isFinite(value)) {
        if (current) segments.push(current);
        current = '';
        continue;
      }
      const x = Math.max(0, 600 - (latest - point.at) / 100);
      const y = 136 - Math.max(0, value) / scale * 124;
      current += `${current ? ' L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`;
    }
    if (current) segments.push(current);
    return segments;
  };
  return { scale, download: paths('download'), upload: paths('upload') };
}
