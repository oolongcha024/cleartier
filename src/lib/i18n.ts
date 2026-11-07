import i18n from 'i18next';
import { initReactI18next } from 'react-i18next';

// Interface copy is kept together so additional locales can use the same keys.
export const zhCN = {
  app: {
    name: 'ClearTier', demo: '演示数据', loading: '加载中…',
    demoDescription: '当前使用模拟数据，连接操作不会访问真实网络。',
    skip: '跳转到主要内容', navigation: '主导航', close: '关闭',
    theme: '切换外观', light: '浅色', dark: '深色', system: '跟随系统',
    collapse: '收起导航', expand: '展开导航',
  },
  nav: {
    dashboard: '仪表盘', networks: '网络配置', devices: '网络设备',
    connections: '连接详情', diagnostics: '网络诊断', activity: '连接记录', settings: '设置',
    workspace: '工作空间',
  },
  dashboard: {
    selectNetwork: '选择网络', networksOnline: '{{count}} 个网络在线',
    allOffline: '所有网络已断开', manage: '管理网络', join: '加入网络',
    connected: '已连接到网络节点', waiting: '正在等待网络节点',
    disconnected: '网络已断开', starting: '正在启动连接', stopping: '正在断开连接',
    peers: '{{count}} 台远端设备 · {{direct}} 台直连',
    offlineHint: '连接后，即可与网络中的设备互相访问',
    waitingHint: '核心已运行，尚未发现远端设备',
    startingHint: '正在启动核心并发现网络节点', stoppingHint: '正在停止当前网络实例',
    connectedShort: '已连接', idle: '未连接', running: '等待节点',
    startingShort: '连接中', stoppingShort: '断开中',
    connect: '连接网络', disconnect: '断开连接',
    connectNamed: '连接 {{name}}', disconnectNamed: '断开 {{name}}',
    virtualIp: '本机虚拟 IP', latency: '入口节点延迟', peerLatency: '延迟', autoConnect: '自动连接',
    autoConnectLabel: '{{name}} 自动连接',
    quickActions: '快捷操作', invite: '邀请朋友', inviteHint: '分享网络凭据',
    copyIp: '复制 IP', copyAddress: '复制 {{value}}', copyIpHint: '本机的虚拟地址',
    devices: '查看设备', devicesHint: '谁在这个网络里',
    configure: '网络配置', configureHint: '查看连接参数',
    traffic: '网络流量', lastMinute: '最近 60 秒', upload: '上传', download: '下载',
    chartLabel: '{{name}} 最近 60 秒模拟流量，上传 {{upload}}，下载 {{download}}',
    sixtyAgo: '60 秒前', thirtyAgo: '30 秒前', now: '现在', trafficOffline: '连接后显示流量',
    networks: '我的网络', networkCount: '{{count}} 个网络', viewing: '当前查看',
    deviceCount: '{{count}} 台设备',
    devicesTitle: '网络设备', devicesOnline: '{{count}} 台在线',
    allDevices: '查看全部', device: '设备', address: '虚拟 IP', connection: '连接',
    direct: '直连', relay: '中转',
    recent: '最近动态', allActivity: '全部记录', noActivity: '暂无连接记录',
    noDevices: '暂无远端设备', noDevicesHint: '连接到节点后，设备会显示在这里',
    soon: '后续提供', pendingTitle: '这个页面正在准备中',
    pendingBody: '目前可以在仪表盘查看网络状态并体验连接操作。',
    back: '返回仪表盘', switchHint: '查看 {{name}}',
  },
  settings: { appearance: '外观', theme: '主题' },
  feedback: {
    copied: '已复制 {{value}}', copyFailed: '浏览器未允许复制，请手动选择下方地址',
    autoOn: '已开启 {{name}} 自动连接（演示）', autoOff: '已关闭 {{name}} 自动连接（演示）',
  },
  event: {
    connected: '{{name}} 已连接', disconnected: '{{name}} 已断开', peers: '发现 {{count}} 台远端设备',
    manual: '已按你的操作停止连接', direct: '{{device}} 已建立直连', directDetail: 'UDP · {{latency}} ms',
  },
};

void i18n.use(initReactI18next).init({
  resources: { 'zh-CN': { translation: zhCN } },
  lng: 'zh-CN', fallbackLng: 'zh-CN', interpolation: { escapeValue: false },
});
export default i18n;
