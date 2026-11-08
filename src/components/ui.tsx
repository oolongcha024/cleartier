import { createContext, useContext, useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode, type Ref, type RefObject } from 'react';
import { Dialog as BaseDialog } from '@base-ui/react/dialog';
import { Select as BaseSelect } from '@base-ui/react/select';
import { Switch as BaseSwitch } from '@base-ui/react/switch';
import { Tooltip } from '@base-ui/react/tooltip';
import { useTranslation } from 'react-i18next';

export function Icon({ name, className = '' }: { name: string; className?: string }) {
  return <span aria-hidden="true" className={`material-symbols-rounded icon ${className}`}>{name}</span>;
}
interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'filled' | 'tonal' | 'outlined' | 'text'; icon?: string;
}
export function Button({ variant = 'filled', icon, children, className = '', type = 'button', ...props }: ButtonProps) {
  return <button type={type} className={`button button--${variant} ${className}`} {...props}>
    {icon && <Icon name={icon} />}{children}
  </button>;
}
export function Hint({ label, children }: { label: string; children: ReactNode }) {
  return <Tooltip.Root>
    <Tooltip.Trigger render={<span className="hint-anchor" />}>{children}</Tooltip.Trigger>
    <Tooltip.Portal><Tooltip.Positioner sideOffset={8} className="tooltip-positioner">
      <Tooltip.Popup className="tooltip">{label}</Tooltip.Popup>
    </Tooltip.Positioner></Tooltip.Portal>
  </Tooltip.Root>;
}
interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> { icon: string; label: string }
export function IconButton({ icon, label, className = '', type = 'button', ...props }: IconButtonProps) {
  return <Hint label={label}><button type={type} aria-label={label} className={`icon-button ${className}`} {...props}>
    <Icon name={icon} />
  </button></Hint>;
}
export function Card({ className = '', children, ...props }: HTMLAttributes<HTMLElement>) {
  return <section className={`card ${className}`} {...props}>{children}</section>;
}
export function Chip({ children, tone = 'neutral', dot = false }: {
  children: ReactNode; tone?: 'neutral' | 'success' | 'primary'; dot?: boolean;
}) {
  return <span className={`chip chip--${tone}`}>{dot && <span className="status-dot" />}{children}</span>;
}
export function Switch({ checked, onChange, label, disabled = false }: { checked: boolean; onChange: (value: boolean) => void; label: string; disabled?: boolean }) {
  return <BaseSwitch.Root className="switch" checked={checked} onCheckedChange={onChange} aria-label={label} disabled={disabled}>
    <BaseSwitch.Thumb className="switch-thumb">{checked && <Icon name="check" />}</BaseSwitch.Thumb>
  </BaseSwitch.Root>;
}
export interface SelectOption { value: string; label: string; icon?: string; leading?: ReactNode; suffix?: ReactNode }
export function Select({ value, onChange, options, label, icon, className = '', popupClassName = '' }: {
  value: string; onChange: (value: string) => void; options: SelectOption[];
  label: string; icon?: string; className?: string; popupClassName?: string;
}) {
  const leading = options.find((option) => option.value === value)?.leading;
  return <BaseSelect.Root value={value} onValueChange={(next) => { if (next !== null) onChange(next); }} items={options}>
    <BaseSelect.Trigger className={`select-trigger ${className}`} aria-label={label}>
      {leading && <span className="select-leading">{leading}</span>}
      {icon && <span className="select-leading"><Icon name={icon} /></span>}
      <BaseSelect.Value /><BaseSelect.Icon className="select-chevron"><Icon name="expand_more" /></BaseSelect.Icon>
    </BaseSelect.Trigger>
    <BaseSelect.Portal><BaseSelect.Positioner sideOffset={8} align="start" alignItemWithTrigger={false} className="select-positioner">
      <BaseSelect.Popup className={`select-popup ${popupClassName}`}><BaseSelect.List>
        {options.map((option) => <BaseSelect.Item key={option.value} value={option.value} className="select-option">
          {option.leading && <span className="select-option-leading">{option.leading}</span>}
          {option.icon && <Icon name={option.icon} />}
          <BaseSelect.ItemText className="select-option-text">{option.label}</BaseSelect.ItemText>
          {option.suffix && <span className="select-option-suffix">{option.suffix}</span>}
          <BaseSelect.ItemIndicator keepMounted className="select-indicator"><Icon name="check" /></BaseSelect.ItemIndicator>
        </BaseSelect.Item>)}
      </BaseSelect.List></BaseSelect.Popup>
    </BaseSelect.Positioner></BaseSelect.Portal>
  </BaseSelect.Root>;
}
export function TextField({ label, value, onChange, name, type = 'text', multiline = false, placeholder, hint, error, trailing, inputRef, textareaRef, rows = 3, disabled = false, inputMode, maxLength }: {
  label: string; value: string; onChange: (value: string) => void; name: string;
  type?: 'text' | 'password'; multiline?: boolean; placeholder?: string; hint?: string; error?: string;
  trailing?: ReactNode; inputRef?: Ref<HTMLInputElement>;
  textareaRef?: Ref<HTMLTextAreaElement>; rows?: number;
  disabled?: boolean; inputMode?: 'numeric'; maxLength?: number;
}) {
  const id = useId();
  const shared = { id, name, value, placeholder, disabled, inputMode, maxLength, 'aria-invalid': !!error,
    'aria-describedby': error || hint ? `${id}-support` : undefined, spellCheck: false };
  return <div className={`text-field ${error ? 'text-field--error' : ''}`}>
    <div className="text-field-control">
      <label htmlFor={id}>{label}</label>
      {multiline ? <textarea {...shared} ref={textareaRef} rows={rows} onChange={(event) => onChange(event.target.value)} />
        : <input {...shared} ref={inputRef} type={type} autoComplete={type === 'password' ? 'new-password' : 'off'}
          onChange={(event) => onChange(event.target.value)} />}
      {trailing && <span className="text-field-trailing">{trailing}</span>}
    </div>
    {(error || hint) && <p id={`${id}-support`} className="text-field-support" role={error ? 'alert' : undefined}>{error || hint}</p>}
  </div>;
}
export function Dialog({ open, onOpenChange, title, description, children, className = '', initialFocus }: {
  open: boolean; onOpenChange: (value: boolean) => void; title: string; description?: string; children: ReactNode;
  className?: string; initialFocus?: RefObject<HTMLElement | null>;
}) {
  const { t } = useTranslation();
  return <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
    <BaseDialog.Portal><BaseDialog.Backdrop className="dialog-backdrop" />
      <BaseDialog.Popup className={`dialog-popup ${className}`} initialFocus={initialFocus}>
        <div className="dialog-heading"><BaseDialog.Title>{title}</BaseDialog.Title>
          <IconButton icon="close" label={t('app.close')} onClick={() => onOpenChange(false)} />
        </div>
        {description && <BaseDialog.Description className="dialog-description">{description}</BaseDialog.Description>}
        {children}
      </BaseDialog.Popup>
    </BaseDialog.Portal>
  </BaseDialog.Root>;
}
const SnackbarContext = createContext<(message: string) => void>(() => {});
export function SnackbarProvider({ children }: { children: ReactNode }) {
  const [notice, setNotice] = useState<{ id: number; message: string; closing: boolean } | null>(null);
  const sequence = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { t } = useTranslation();
  useEffect(() => () => clearTimeout(timer.current), []);
  const dismiss = () => {
    clearTimeout(timer.current);
    setNotice((current) => current ? { ...current, closing: true } : null);
  };
  const notify = (next: string) => {
    if (!next.trim()) { dismiss(); return; }
    clearTimeout(timer.current);
    const id = ++sequence.current;
    setNotice({ id, message: next, closing: false });
    timer.current = setTimeout(() => {
      setNotice((current) => current?.id === id ? { ...current, closing: true } : current);
    }, 4500);
  };
  return <SnackbarContext value={notify}>{children}
    <div className="snackbar-region" role="status" aria-live="polite" aria-atomic="true">
      {notice && <div key={notice.id} className={`snackbar ${notice.closing ? 'snackbar--closing' : 'snackbar--visible'}`}
        onAnimationEnd={(event) => {
          if (event.target !== event.currentTarget || event.animationName !== 'snackbar-exit') return;
          // Retain content through the exit, then remove this specific notice.
          // A late event from an older notice must never dismiss its replacement.
          setNotice((current) => current?.id === notice.id && current.closing ? null : current);
        }}>
        <span>{notice.message}</span>
        <button aria-label={t('app.close')} onClick={dismiss}><Icon name="close" /></button>
      </div>}
    </div>
  </SnackbarContext>;
}
export const useSnackbar = () => useContext(SnackbarContext);
