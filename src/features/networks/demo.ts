import type { Network } from './model';
import { createNetworkConfig } from './defaults.ts';

const download = [22, 25, 21, 34, 27, 25, 44, 38, 31, 36, 29, 45, 38, 35, 54, 49, 42, 57, 47, 44, 65, 58, 48, 62, 53, 47, 58, 66, 54, 60, 72];
const upload = [9, 12, 10, 14, 11, 10, 17, 12, 13, 17, 13, 20, 16, 15, 22, 18, 15, 21, 18, 15, 25, 19, 17, 23, 18, 16, 21, 24, 18, 21, 27];
const officeConfig = createNetworkConfig('office', { name: 'studio-work', secret: 'demo-office-key', servers: ['tcp://office.example.com:11010'] });
const gamingConfig = createNetworkConfig('gaming', { name: 'weekend-party', secret: 'demo-game-key', servers: ['udp://game.example.com:11010'] });
const homeConfig = createNetworkConfig('home', { name: 'home-lab', secret: '', servers: ['tcp://home.example.com:11010'] });
export const demoNetworks: Network[] = [
  {
    id: 'office', alias: '远程办公室', icon: 'work', savedConfig: officeConfig, runningConfig: officeConfig,
    coreState: 'running', autoConnect: true, virtualIp: '10.42.0.8', entryLatency: 12,
    download: 2.4, upload: 0.128, traffic: { download, upload },
    trafficTotals: { downloadBytes: 2_000_000_000, uploadBytes: 134_217_728 },
    peers: [
      { id: 'nas', name: 'Studio NAS', ip: '10.42.0.1', platform: 'dns', connection: 'direct', latency: 12 },
      { id: 'mac', name: 'MacBook Pro', ip: '10.42.0.3', platform: 'laptop_mac', connection: 'direct', latency: 18 },
      { id: 'pc', name: '办公室 PC', ip: '10.42.0.12', platform: 'desktop_windows', connection: 'relay', latency: 36 },
    ],
  },
  {
    id: 'gaming', alias: '周末联机', icon: 'sports_esports', savedConfig: gamingConfig, runningConfig: gamingConfig,
    coreState: 'running', autoConnect: false, virtualIp: '10.56.0.2', entryLatency: 24,
    download: 0.860, upload: 0.096,
    trafficTotals: { downloadBytes: 478_150_656, uploadBytes: 83_886_080 },
    traffic: { download: download.map((point, i) => point * (i % 3 === 0 ? 0.6 : 0.8)), upload: upload.map((point) => point * 0.7) },
    peers: [
      { id: 'player1', name: 'Alex 的电脑', ip: '10.56.0.3', platform: 'desktop_windows', connection: 'direct', latency: 24 },
      { id: 'player2', name: 'Pixel Station', ip: '10.56.0.5', platform: 'desktop_windows', connection: 'direct', latency: 28 },
    ],
  },
  {
    id: 'home', alias: '家里的小网络', icon: 'home', savedConfig: homeConfig, runningConfig: null,
    coreState: 'stopped', autoConnect: false, virtualIp: '10.68.0.6', entryLatency: 8,
    download: 0.320, upload: 0.064,
    trafficTotals: null,
    traffic: { download: download.map((point) => point * 0.5), upload: upload.map((point) => point * 0.6) },
    peers: [{ id: 'home-nas', name: 'Home Server', ip: '10.68.0.1', platform: 'dns', connection: 'direct', latency: 8 }],
  },
];
