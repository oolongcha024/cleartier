import { useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { useLocation } from 'react-router';
import { useSnackbar } from '../../components/ui';
import { useUpdates } from './store';

export function UpdateLifecycle() {
  const { t } = useTranslation();
  const { start, snapshot } = useUpdates();
  const notify = useSnackbar();
  const { pathname } = useLocation();
  const notified = useRef(new Set<string>());
  useEffect(start, [start]);
  const version = snapshot?.candidate?.version;
  useEffect(() => {
    if (version && !notified.current.has(version)) {
      notified.current.add(version);
      if (pathname !== '/settings/about') notify(t('updates.discovered', { version }));
    }
  }, [version, pathname, notify, t]);
  return null;
}
