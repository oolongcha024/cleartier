import { initializePlatform } from './platform';

async function start() {
  await initializePlatform();
  await import('./app/mount');
  if (import.meta.env.DEV) {
    const { mountWorkbench } = await import('../dev/workbench');
    mountWorkbench();
  }
}
void start().catch((error: unknown) => {
  console.error('Application initialization failed', error);
  document.getElementById('root')!.textContent = '应用初始化失败，请重新打开。';
});
