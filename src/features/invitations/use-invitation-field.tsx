import { useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Icon, TextField } from '../../components/ui';
import { decodeInvitation, invitationError, maxInvitationInput, type Invitation } from './invitation';

// Invitation text is a one-time import, not a second configuration source. Keep
// this state in the editor session so confirmations and failed writes retain it.
export function useInvitationField(onFill: (invitation: Invitation) => void, inputRef: RefObject<HTMLTextAreaElement | null>, focusForm: () => void) {
  const { t } = useTranslation();
  const [input, setInput] = useState({ text: '', error: '', applied: false });
  const change = (text: string) => {
    if (!text.trim()) { setInput({ text, error: '', applied: false }); return; }
    try {
      const invitation = decodeInvitation(text);
      onFill(invitation);
      // Move focus before removing its input; the dialog would otherwise
      // restore focus to the popup after our next-frame focus request.
      focusForm();
      setInput({ text: '', error: '', applied: true });
    } catch (error) { setInput({ text, error: invitationError(error), applied: false }); }
  };
  const replace = () => {
    focusForm();
    setInput({ text: '', error: '', applied: false });
    requestAnimationFrame(() => inputRef.current?.focus({ preventScroll: true }));
  };
  return { dirty: Boolean(input.text), field: <div className="network-invitation-field">
    <span className="invitation-announcement" role="status" aria-live="polite" aria-atomic="true">{input.applied ? t('invitation.filled') : ''}</span>
    <div className="invitation-input-slot">
      {input.applied ? <div className="invitation-applied" role="group" aria-label={t('invitation.content')}>
        <Icon name="check_circle" /><span aria-hidden="true">{t('invitation.filled')}</span>
        <Button variant="text" onClick={replace}>{t('invitation.replace')}</Button>
      </div> : <TextField name="invitation" label={t('invitation.pasteLabel')} multiline rows={1} value={input.text} onChange={change}
        textareaRef={inputRef} maxLength={maxInvitationInput + 1} placeholder="cleartier:v1:…"
        error={input.error ? t(`invitation.fillErrors.${input.error}`, { defaultValue: t('invitation.fillErrors.invalid') }) : undefined} />}
    </div>
  </div> };
}
