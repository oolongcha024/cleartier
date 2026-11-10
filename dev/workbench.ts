import { scenarios } from './scenarios/index.ts';
import './workbench.css';

export function mountWorkbench() {
  const session = window.__CLEARTIER_DEV__;
  if (!session || document.querySelector('.dev-workbench')) return;
  const panel = document.createElement('details');
  panel.className = 'dev-workbench';
  panel.innerHTML = `
    <summary>开发 · ${session.source === 'mock' ? '模拟数据' : '真实数据'}</summary>
    <div class="dev-workbench-fields">
      <label>数据来源<select aria-label="数据来源"><option value="mock">模拟数据</option><option value="native">真实 Tauri</option></select></label>
      <label>场景<select aria-label="调试场景"></select></label>
      <label class="dev-workbench-progress">下载进度<output></output><input type="range" min="0" max="100" aria-label="模拟下载进度" /></label>
      <label>外观<select aria-label="调试外观"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
      <p>切换数据来源或场景将重新加载并重置模拟数据。</p>
    </div>`;
  const source = panel.querySelector<HTMLSelectElement>('[aria-label="数据来源"]')!;
  source.value = session.source;
  source.querySelector<HTMLOptionElement>('[value="native"]')!.disabled = !session.nativeAvailable;
  const scene = panel.querySelector<HTMLSelectElement>('[aria-label="调试场景"]')!;
  for (const item of scenarios) {
    let group = [...scene.querySelectorAll('optgroup')].find((node) => node.label === item.group);
    if (!group) {
      group = document.createElement('optgroup');
      group.label = item.group;
      scene.append(group);
    }
    const option = document.createElement('option');
    option.value = item.id;
    option.textContent = item.label;
    group.append(option);
  }
  scene.value = session.scene === 'testing' ? 'default' : session.scene;
  scene.disabled = session.source !== 'mock';
  const navigate = (dataSource: string, id: string) => {
    const url = new URL(location.href);
    url.searchParams.set('dataSource', dataSource);
    url.searchParams.set('scene', id);
    if (dataSource === 'mock')
      url.hash = `#${scenarios.find((item) => item.id === id)?.route ?? '/'}`;
    location.assign(url.href);
  };
  source.addEventListener('change', () => navigate(source.value, 'default'));
  scene.addEventListener('change', () => navigate('mock', scene.value));
  const progress = panel.querySelector<HTMLInputElement>('input[type="range"]')!;
  const progressRow = panel.querySelector<HTMLElement>('.dev-workbench-progress')!;
  const updateProgress = () => {
    const update = session.mock?.updates;
    progressRow.hidden = update?.status.phase !== 'downloading';
    if (update) {
      progress.value = String(update.status.downloaded);
      panel.querySelector('output')!.value = `${update.status.downloaded}%`;
    }
  };
  updateProgress();
  let stopUpdates: (() => void) | undefined;
  let disposed = false;
  if (session.mock)
    void session.platform.updates.watch(updateProgress).then((stop) => {
      if (disposed) stop();
      else stopUpdates = stop;
    });
  progress.addEventListener('input', () => {
    const update = session.mock?.updates;
    if (!update || update.status.phase !== 'downloading') return;
    update.status.total = 100;
    update.status.downloaded = Number(progress.value);
    update.emit();
    updateProgress();
  });
  const theme = panel.querySelector<HTMLSelectElement>('[aria-label="调试外观"]')!;
  theme.value = localStorage.getItem('cleartier.theme') ?? 'system';
  theme.addEventListener('change', () => {
    localStorage.setItem('cleartier.theme', theme.value);
    location.reload();
  });
  document.body.append(panel);
  if (import.meta.hot)
    import.meta.hot.dispose(() => {
      disposed = true;
      stopUpdates?.();
      panel.remove();
    });
}
