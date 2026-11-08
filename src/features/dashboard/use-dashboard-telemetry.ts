import { useMemo } from 'react';
import { useNetworkTelemetry } from '../networks/store';
import type { Network } from '../networks/model';
import type { NetworkTelemetry } from '../networks/telemetry';

export function useDashboardTelemetry(network: Network): NetworkTelemetry {
  const live = useNetworkTelemetry(network.id);
  return useMemo(() => {
    if (network.peerCount !== undefined) return live;
    const running = network.coreState === 'running';
    const history = network.traffic;
    const length = Math.max(history.download.length, history.upload.length);
    const scale = (value: number, last: number | undefined, rate: number) => last ? value / last * rate * 1024 ** 2 : 0;
    return {
      freshness: running ? 'fresh' : 'stopped', updatedAt: 0,
      download: running ? network.download * 1024 ** 2 : null,
      upload: running ? network.upload * 1024 ** 2 : null,
      snapshot: {
        session: `demo-${network.id}`, elapsedMs: 60_000, hostname: network.runningConfig?.hostname || 'ClearTier-PC',
        peers: network.peers, incomplete: false,
        downloadBytes: String(network.trafficTotals?.downloadBytes ?? 0), uploadBytes: String(network.trafficTotals?.uploadBytes ?? 0),
      },
      points: Array.from({ length }, (_, index) => ({ at: index * 60_000 / Math.max(1, length - 1),
        download: scale(history.download[index] ?? 0, history.download.at(-1), network.download),
        upload: scale(history.upload[index] ?? 0, history.upload.at(-1), network.upload) })),
    };
  }, [live, network]);
}
