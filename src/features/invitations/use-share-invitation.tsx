import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Dialog, useSnackbar } from '../../components/ui';
import { copyText } from '../../lib/clipboard';
import { readJoinParameters } from '../../platform/invitations';
import { readNetwork } from '../networks/store';
import { invitationError } from './invitation';
import { shareInvitation } from './share-invitation';

export function useShareInvitation(id: string) {
  const { t } = useTranslation();
  const notify = useSnackbar();
  const [sharing, setSharing] = useState(false);
  const [manual, setManual] = useState<{ text: string; pending: boolean } | null>(null);
  const input = useRef<HTMLTextAreaElement>(null);
  const active = useRef(false);
  const mounted = useRef(true);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  const share = async () => {
    if (active.current) return;
    active.current = true; setSharing(true);
    try {
      const result = await shareInvitation(() => readNetwork(id), { parameters: readJoinParameters, copy: copyText });
      if (!mounted.current) return;
      if (result.copied) notify(t(result.pending ? 'invitation.copiedPending' : 'invitation.copied'));
      else { notify(''); setManual(result); }
    } catch (error) {
      if (mounted.current) notify(t(`invitation.errors.${invitationError(error)}`));
    } finally { active.current = false; if (mounted.current) setSharing(false); }
  };
  return { share, sharing, copyFallback: <Dialog open={Boolean(manual)} onOpenChange={(open) => { if (!open) setManual(null); }}
    title={t('dashboard.invite')} description={t('invitation.manualCopy')} initialFocus={input}>
    {manual?.pending && <p className="invitation-pending-note">{t('invitation.pending')}</p>}
    <textarea ref={input} className="manual-copy invitation-manual-copy" readOnly rows={3} aria-label={t('invitation.content')}
      value={manual?.text ?? ''} onFocus={(event) => event.currentTarget.select()} />
  </Dialog> };
}
