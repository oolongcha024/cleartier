import { useRef, useState } from 'react';
import { Link } from 'react-router';
import { useTranslation } from 'react-i18next';
import { Button, Card, Dialog, Icon, useSnackbar } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { useAboutInfo } from './use-about-info';
import { UpdateCard } from '../updates/UpdateCard';

export function AboutPage() {
  const { t } = useTranslation();
  const { clientVersion, versionUnavailable, coreVersion, coreVersionUnavailable, desktop } =
    useAboutInfo();
  const [manualCopy, setManualCopy] = useState('');
  const copyInput = useRef<HTMLTextAreaElement>(null);
  const notify = useSnackbar();
  const clientValue = clientVersion ?? t(versionUnavailable ? 'about.unavailable' : 'app.loading');
  const coreValue =
    coreVersion ??
    t(
      !desktop ? 'about.corePreview' : coreVersionUnavailable ? 'about.unavailable' : 'app.loading',
    );
  const versionsPending =
    (!clientVersion && !versionUnavailable) || (desktop && !coreVersion && !coreVersionUnavailable);
  const environment = t(desktop ? 'about.desktop' : 'about.browser');
  const handleCopy = async () => {
    const text = [
      `${t('app.name')} ${clientValue}`,
      `${t('about.coreVersion')}: ${coreValue}`,
      `${t('about.environment')}: ${environment}`,
    ].join('\n');
    if (await copyText(text)) notify(t('about.copied'));
    else setManualCopy(text);
  };

  return (
    <div className="about-page">
      <Link to="/settings" className="button button--text about-back">
        <Icon name="arrow_back" />
        {t('about.back')}
      </Link>
      <Card className="about-card">
        <div className="about-brand">
          <span className="brand-mark">
            <span className="brand-logo" aria-hidden="true" />
          </span>
          <h2>{t('app.name')}</h2>
          <Button
            variant="outlined"
            icon="content_copy"
            disabled={versionsPending}
            onClick={() => {
              void handleCopy();
            }}
          >
            {t('about.copy')}
          </Button>
        </div>
        <dl className="about-info">
          <div>
            <dt>{t('about.clientVersion')}</dt>
            <dd>{clientValue}</dd>
          </div>
          <div>
            <dt>{t('about.coreVersion')}</dt>
            <dd>{coreValue}</dd>
          </div>
          <div>
            <dt>{t('about.environment')}</dt>
            <dd>{environment}</dd>
          </div>
        </dl>
      </Card>
      <UpdateCard />
      <Dialog
        open={Boolean(manualCopy)}
        onOpenChange={(open) => {
          if (!open) setManualCopy('');
        }}
        title={t('about.copy')}
        description={t('about.copyFailed')}
        initialFocus={copyInput}
      >
        <textarea
          ref={copyInput}
          className="manual-copy about-copy"
          aria-label={t('about.versionInfo')}
          readOnly
          rows={4}
          value={manualCopy}
          onFocus={(event) => event.currentTarget.select()}
        />
      </Dialog>
    </div>
  );
}
