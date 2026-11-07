import { createContext, useContext, useEffect, useRef, useState, type ButtonHTMLAttributes, type HTMLAttributes, type ReactNode } from 'react';
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
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return <BaseSwitch.Root className="switch" checked={checked} onCheckedChange={onChange} aria-label={label}>
    <BaseSwitch.Thumb className="switch-thumb">{checked && <Icon name="check" />}</BaseSwitch.Thumb>
  </BaseSwitch.Root>;
}
export interface SelectOption { value: string; label: string; icon?: string; suffix?: ReactNode }
export function Select({ value, onChange, options, label, icon, className = '' }: {
  value: string; onChange: (value: string) => void; options: SelectOption[];
  label: string; icon?: string; className?: string;
}) {
  return <BaseSelect.Root value={value} onValueChange={(next) => { if (next !== null) onChange(next); }} items={options}>
    <BaseSelect.Trigger className={`select-trigger ${className}`} aria-label={label}>
      {icon && <span className="select-leading"><Icon name={icon} /></span>}
      <BaseSelect.Value /><BaseSelect.Icon className="select-chevron"><Icon name="expand_more" /></BaseSelect.Icon>
    </BaseSelect.Trigger>
    <BaseSelect.Portal><BaseSelect.Positioner sideOffset={8} align="start" alignItemWithTrigger={false} className="select-positioner">
      <BaseSelect.Popup className="select-popup"><BaseSelect.List>
        {options.map((option) => <BaseSelect.Item key={option.value} value={option.value} className="select-option">
          {option.icon && <Icon name={option.icon} />}
          <BaseSelect.ItemText>{option.label}</BaseSelect.ItemText>
          {option.suffix}<BaseSelect.ItemIndicator className="select-indicator"><Icon name="check" /></BaseSelect.ItemIndicator>
        </BaseSelect.Item>)}
      </BaseSelect.List></BaseSelect.Popup>
    </BaseSelect.Positioner></BaseSelect.Portal>
  </BaseSelect.Root>;
}
export function Dialog({ open, onOpenChange, title, description, children }: {
  open: boolean; onOpenChange: (value: boolean) => void; title: string; description?: string; children: ReactNode;
}) {
  const { t } = useTranslation();
  return <BaseDialog.Root open={open} onOpenChange={onOpenChange}>
    <BaseDialog.Portal><BaseDialog.Backdrop className="dialog-backdrop" />
      <BaseDialog.Popup className="dialog-popup">
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
  const [message, setMessage] = useState('');
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const { t } = useTranslation();
  useEffect(() => () => clearTimeout(timer.current), []);
  const notify = (next: string) => {
    clearTimeout(timer.current);
    setMessage(next);
    timer.current = setTimeout(() => setMessage(''), 4500);
  };
  return <SnackbarContext value={notify}>{children}
    <div className={`snackbar ${message ? 'snackbar--visible' : ''}`}>
      <span role="status" aria-live="polite">{message}</span>
      {message && <button aria-label={t('app.close')} onClick={() => setMessage('')}><Icon name="close" /></button>}
    </div>
  </SnackbarContext>;
}
export const useSnackbar = () => useContext(SnackbarContext);
