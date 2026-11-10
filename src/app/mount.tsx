import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import '../lib/i18n';
import 'material-symbols/rounded.css';
import '../styles.css';

const root = createRoot(document.getElementById('root')!);
root.render(
  <StrictMode>
    <App />
  </StrictMode>,
);

window.addEventListener('pagehide', (event) => {
  if (!event.persisted) root.unmount();
});
