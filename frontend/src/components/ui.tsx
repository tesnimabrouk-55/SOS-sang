import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from 'react';

/* ------------------------------------------------------------------ icones */

type IconProps = { className?: string };
const base = 'h-5 w-5';
const svg = (path: ReactNode, extra?: string) =>
  function Icon({ className }: IconProps) {
    return (
      <svg
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={1.7}
        strokeLinecap="round"
        strokeLinejoin="round"
        className={`${base} ${extra ?? ''} ${className ?? ''}`}
        aria-hidden="true"
      >
        {path}
      </svg>
    );
  };

export const DropIcon = svg(<path d="M12 3c3.5 4.6 6.5 7.8 6.5 11a6.5 6.5 0 1 1-13 0C5.5 10.8 8.5 7.6 12 3z" />);
export const HeartIcon = svg(<path d="M12 20s-7-4.35-7-9a4 4 0 0 1 7-2.6A4 4 0 0 1 19 11c0 4.65-7 9-7 9z" />);
export const PinIcon = svg(
  <>
    <path d="M12 21s6-5.3 6-10a6 6 0 1 0-12 0c0 4.7 6 10 6 10z" />
    <circle cx="12" cy="11" r="2.2" />
  </>,
);
export const ClockIcon = svg(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M12 7.5V12l3 2" />
  </>,
);
export const BellIcon = svg(
  <>
    <path d="M6 9a6 6 0 1 1 12 0c0 4 1.5 5.5 1.5 5.5h-15S6 13 6 9z" />
    <path d="M10 18a2 2 0 0 0 4 0" />
  </>,
);
export const UsersIcon = svg(
  <>
    <circle cx="9" cy="8" r="3.2" />
    <path d="M3.5 19c0-3 2.5-5 5.5-5s5.5 2 5.5 5" />
    <path d="M16 5.5a3 3 0 0 1 0 5.8M17 14c2.2.4 3.8 2.2 3.8 4.4" />
  </>,
);
export const BuildingIcon = svg(
  <>
    <path d="M4 20V6.5L12 3l8 3.5V20" />
    <path d="M9 20v-5h6v5M9 8h.01M12 8h.01M15 8h.01M9 11h.01M12 11h.01M15 11h.01" />
  </>,
);
export const ShieldIcon = svg(<path d="M12 3.5 19 6v6c0 4.2-3 7.3-7 8.5-4-1.2-7-4.3-7-8.5V6l7-2.5z" />);
export const CheckIcon = svg(<path d="m5 12.5 4.5 4.5L19 7" />);
export const CrossIcon = svg(<path d="M6 6l12 12M18 6 6 18" />);
export const ArrowIcon = svg(<path d="M5 12h13M13 6l6 6-6 6" />);
export const MenuIcon = svg(<path d="M4 7h16M4 12h16M4 17h16" />);
export const GlobeIcon = svg(
  <>
    <circle cx="12" cy="12" r="8.5" />
    <path d="M3.5 12h17M12 3.5c2.4 2.4 3.6 5.3 3.6 8.5S14.4 18.1 12 20.5C9.6 18.1 8.4 15.2 8.4 12S9.6 5.9 12 3.5z" />
  </>,
);
export const ChartIcon = svg(
  <>
    <path d="M4 20h16" />
    <path d="M7 20v-6M12 20V6M17 20v-9" />
  </>,
);
export const LayersIcon = svg(
  <>
    <path d="m12 3 8 4.5-8 4.5-8-4.5L12 3z" />
    <path d="m4 12 8 4.5 8-4.5M4 16.5 12 21l8-4.5" />
  </>,
);
export const PulseIcon = svg(<path d="M3 12h4l2.5-6 4 12L16 12h5" />);
export const DocIcon = svg(
  <>
    <path d="M7 3.5h7l4 4V20a.5.5 0 0 1-.5.5h-10A.5.5 0 0 1 7 20V3.5z" />
    <path d="M14 3.5V8h4M10 12h5M10 16h5" />
  </>,
);

/* ------------------------------------------------------------------ primitives */

export function Spinner({ className = '' }: { className?: string }) {
  return (
    <span
      className={`inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent ${className}`}
      role="status"
      aria-label="chargement"
    />
  );
}

export function Card({ children, className = '' }: { children: ReactNode; className?: string }) {
  return <div className={`card ${className}`}>{children}</div>;
}

export function SectionTitle({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-lg font-semibold tracking-tight text-ink-800">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-ink-500">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode;
  tone?: 'neutral' | 'red' | 'green' | 'amber' | 'slate' | 'blue';
  className?: string;
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-ink-100 text-ink-600',
    red: 'bg-blood-50 text-blood-700',
    green: 'bg-vital-50 text-vital-600',
    amber: 'bg-amber-50 text-amber-700',
    slate: 'bg-ink-800 text-white',
    blue: 'bg-sky-50 text-sky-700',
  };
  return <span className={`badge ${tones[tone]} ${className}`}>{children}</span>;
}

export function BloodTag({ group, size = 'md' }: { group: string; size?: 'sm' | 'md' | 'lg' }) {
  const sizes = { sm: 'h-7 min-w-7 px-1.5 text-[11px]', md: 'h-9 min-w-9 px-2 text-xs', lg: 'h-12 min-w-12 px-2.5 text-sm' };
  return (
    <span
      className={`inline-flex items-center justify-center rounded-lg bg-blood-600 font-bold text-white shadow-sm ${sizes[size]}`}
    >
      {group}
    </span>
  );
}

export function Field({
  label,
  hint,
  error,
  children,
  htmlFor,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: ReactNode;
  htmlFor?: string;
}) {
  return (
    <div>
      <label className="label" htmlFor={htmlFor}>
        {label}
      </label>
      {children}
      {hint && !error ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
      {error ? <p className="mt-1 text-xs font-medium text-blood-700">{error}</p> : null}
    </div>
  );
}

export function Input(props: InputHTMLAttributes<HTMLInputElement>) {
  const { className = '', ...rest } = props;
  return <input {...rest} className={`input ${className}`} />;
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  const { className = '', children, ...rest } = props;
  return (
    <select {...rest} className={`input ${className}`}>
      {children}
    </select>
  );
}

export function Textarea(props: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  const { className = '', ...rest } = props;
  return <textarea {...rest} className={`input min-h-[92px] ${className}`} />;
}

export function Button({
  variant = 'primary',
  loading = false,
  children,
  className = '',
  ...rest
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger'; loading?: boolean }) {
  const map = { primary: 'btn-primary', secondary: 'btn-secondary', ghost: 'btn-ghost', danger: 'btn-danger' };
  return (
    <button {...rest} className={`${map[variant]} ${className}`} disabled={rest.disabled || loading}>
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

export function Toggle({
  checked,
  onChange,
  label,
  disabled,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition disabled:opacity-50 ${
        checked ? 'bg-vital-500' : 'bg-ink-300'
      }`}
    >
      <span
        className={`inline-block h-4.5 w-4.5 transform rounded-full bg-white shadow transition ${
          checked ? 'translate-x-6 rtl:-translate-x-6' : 'translate-x-1 rtl:-translate-x-1'
        }`}
        style={{ height: 18, width: 18 }}
      />
    </button>
  );
}

export function Stat({
  label,
  value,
  hint,
  tone = 'neutral',
  icon,
}: {
  label: string;
  value: ReactNode;
  hint?: string;
  tone?: 'neutral' | 'red' | 'green';
  icon?: ReactNode;
}) {
  const tones = { neutral: 'text-ink-800', red: 'text-blood-700', green: 'text-vital-600' };
  return (
    <div className="card-pad">
      <div className="flex items-start justify-between gap-2">
        <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">{label}</p>
        {icon ? <span className="text-ink-300">{icon}</span> : null}
      </div>
      <p className={`mt-2 text-2xl font-bold tracking-tight ${tones[tone]}`}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-ink-400">{hint}</p> : null}
    </div>
  );
}

export function Progress({ value, max, tone = 'red' }: { value: number; max: number; tone?: 'red' | 'green' }) {
  const pct = max > 0 ? Math.min(100, Math.round((value / max) * 100)) : 0;
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-ink-100">
      <div
        className={`h-full rounded-full transition-all ${tone === 'green' ? 'bg-vital-500' : 'bg-blood-500'}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export function EmptyState({ title, text, action }: { title: string; text?: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-ink-200 bg-white/60 px-6 py-12 text-center">
      <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-full bg-ink-100 text-ink-400">
        <DropIcon />
      </span>
      <p className="font-semibold text-ink-700">{title}</p>
      {text ? <p className="mt-1 max-w-sm text-sm text-ink-500">{text}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  );
}

export function ErrorBanner({ message, onRetry, retryLabel = 'Réessayer' }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-blood-200 bg-blood-50 px-4 py-3 text-sm text-blood-800">
      <CrossIcon className="mt-0.5 h-4 w-4 shrink-0" />
      <p className="flex-1">{message}</p>
      {onRetry ? (
        <button type="button" onClick={onRetry} className="font-semibold underline underline-offset-4">
          {retryLabel}
        </button>
      ) : null}
    </div>
  );
}

export function Modal({
  open,
  onClose,
  title,
  children,
  footer,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-ink-900/40 p-0 sm:items-center sm:p-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-lg animate-fade-up rounded-t-2xl bg-white p-5 shadow-lift sm:rounded-2xl sm:p-6">
        <div className="mb-4 flex items-center justify-between gap-3">
          <h3 className="text-base font-semibold text-ink-800">{title}</h3>
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 text-ink-400 hover:bg-ink-100" aria-label="Fermer">
            <CrossIcon />
          </button>
        </div>
        <div className="text-sm text-ink-600">{children}</div>
        {footer ? <div className="mt-6 flex justify-end gap-2">{footer}</div> : null}
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ notifications UI */

type Toast = { id: number; tone: 'success' | 'error' | 'info'; message: string };
const ToastContext = createContext<{ push: (tone: Toast['tone'], message: string) => void } | null>(null);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const push = useCallback((tone: Toast['tone'], message: string) => {
    const id = Date.now() + Math.random();
    setToasts((prev) => [...prev, { id, tone, message }]);
    window.setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4500);
  }, []);

  const value = useMemo(() => ({ push }), [push]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <div className="pointer-events-none fixed bottom-4 z-[60] flex w-full flex-col items-center gap-2 px-4 sm:bottom-6 sm:end-6 sm:w-auto sm:items-end">
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`pointer-events-auto flex w-full max-w-sm animate-fade-up items-start gap-2 rounded-xl px-4 py-3 text-sm font-medium shadow-lift ${
              t.tone === 'success'
                ? 'bg-vital-600 text-white'
                : t.tone === 'error'
                  ? 'bg-blood-700 text-white'
                  : 'bg-ink-800 text-white'
            }`}
            role="status"
          >
            {t.tone === 'success' ? <CheckIcon className="h-4 w-4 shrink-0" /> : null}
            <span>{t.message}</span>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export function useToast() {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast doit etre utilise dans ToastProvider');
  return ctx;
}
