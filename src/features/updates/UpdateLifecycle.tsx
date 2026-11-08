import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useSnackbar } from '../../components/ui';
import { useUpdates } from './store';

export function UpdateLifecycle() {
  const { t } = useTranslation();
  const { start, snapshot } = useUpdates();
  const notify = useSnackbar();
  const notified = useRef(new Set<string>());
  useEffect(start, [start]);
  const version = snapshot?.candidate?.version;
  useEffect(() => {
    if (version && !notified.current.has(version)) {
      notified.current.add(version); notify(t('updates.discovered', { version }));
    }
  }, [version, notify, t]);
  return null;
}
