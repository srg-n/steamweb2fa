import clsx from 'clsx';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, CheckCircle2, Info, XCircle } from 'lucide-react';
import { Button } from './Button';

export type DialogTone = 'default' | 'danger' | 'error' | 'success';

export interface ConfirmOptions {
  /** Heading shown at the top of the panel. Falls back to i18n 'common.confirmTitle'. */
  title?: string;
  /** Body text; can include interpolated content outside of i18n keys. */
  message: ReactNode;
  /** Default: t('common.confirm') when present, otherwise 'OK'. */
  confirmLabel?: string;
  /** Default: t('common.cancel'). */
  cancelLabel?: string;
  /** 'danger' styles the confirmation button red and prefixes the panel with a warning icon. */
  tone?: DialogTone;
}

export interface AlertDialogOptions {
  title?: string;
  message: ReactNode;
  /** Default: t('common.ok'). */
  okLabel?: string;
  tone?: DialogTone;
}

interface PendingDialog {
  tone: DialogTone;
  title?: string;
  message: ReactNode;
  primaryLabel: string;
  secondaryLabel?: string;
  mode: 'confirm' | 'alert';
  resolve: (accepted: boolean) => void;
}

interface DialogsApi {
  confirm(options: ConfirmOptions): Promise<boolean>;
  alert(options: AlertDialogOptions): Promise<void>;
}

const DialogsContext = createContext<DialogsApi | null>(null);

/** Returns the promise-based confirm/alert replacement for window.confirm/alert. */
export function useDialogs(): DialogsApi {
  const api = useContext(DialogsContext);
  if (!api) {
    const detail = 'useDialogs must be used inside <ConfirmDialogProvider>.';
    throw new Error(detail);
  }
  return api;
}

const TONE_ICONS = {
  default: Info,
  danger: AlertTriangle,
  error: XCircle,
  success: CheckCircle2
} as const;

const TONE_ICON_CLASSES = {
  default: 'bg-accent-500/10 text-accent-500',
  danger: 'bg-danger/10 text-danger',
  error: 'bg-danger/10 text-danger',
  success: 'bg-emerald-500/10 text-emerald-500'
} as const;

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
  const [pending, setPending] = useState<PendingDialog | null>(null);
  const primaryRef = useRef<HTMLButtonElement>(null);
  const secondaryRef = useRef<HTMLButtonElement>(null);

  const close = useCallback((accepted: boolean) => {
    setPending((current) => {
      current?.resolve(accepted);
      return null;
    });
  }, []);

  const confirm = useCallback<DialogsApi['confirm']>(
    (options) =>
      new Promise<boolean>((resolve) => {
        setPending({
          mode: 'confirm',
          tone: options.tone ?? 'default',
          title: options.title,
          message: options.message,
          primaryLabel: options.confirmLabel ?? t('common.ok'),
          secondaryLabel: options.cancelLabel ?? t('common.cancel'),
          resolve
        });
      }),
    [t]
  );

  const alert = useCallback<DialogsApi['alert']>(
    async (options) => {
      await new Promise<void>((resolve) => {
        const settle = (accepted: boolean) => {
          resolve();
          return accepted;
        };
        setPending({
          mode: 'alert',
          tone: options.tone ?? 'default',
          title: options.title,
          message: options.message,
          primaryLabel: options.okLabel ?? t('common.ok'),
          resolve: settle
        });
      });
    },
    [t]
  );

  const dangerous = pending?.tone === 'danger' || pending?.tone === 'error';

  // Escape closes; as with the native dialog, confirm resolves as "not accepted".
  useEffect(() => {
    if (!pending) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.stopPropagation();
        close(false);
      }
    };
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [pending, close]);

  // Focus lands on the safe action of a dangerous dialog and on the primary
  // action otherwise; the previous focus is restored when the dialog closes.
  useEffect(() => {
    if (!pending) return;
    const previous = document.activeElement as HTMLElement | null;
    const target =
      pending.mode === 'confirm' && pending.tone === 'danger' ? secondaryRef.current : primaryRef.current;
    target?.focus();
    return () => previous?.focus?.();
  }, [pending]);

  // The background must not scroll behind the fixed overlay.
  useEffect(() => {
    if (!pending) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previous;
    };
  }, [pending]);

  if (!pending) return <DialogsContext.Provider value={{ confirm, alert }}>{children}</DialogsContext.Provider>;

  const Icon = TONE_ICONS[pending.tone] ?? Info;

  return (
    <DialogsContext.Provider value={{ confirm, alert }}>
      {children}
      <div
        className="fixed inset-0 z-[70] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-black/60 backdrop-blur-sm"
        onMouseDown={(e) => {
          if (e.target === e.currentTarget) close(false);
        }}
      >
        <div
          role="dialog"
          aria-modal="true"
          aria-labelledby="dialog-title"
          aria-describedby="dialog-message"
          className="w-full sm:max-w-md rounded-t-2xl sm:rounded-2xl border border-base-200/80 bg-white/95 dark:!bg-[#07070a] dark:!border-white/10 shadow-2xl backdrop-blur-md animate-fade-in-up"
        >
          <div className="p-5 sm:p-6 pb-[max(1.25rem,env(safe-area-inset-bottom))] sm:pb-6 space-y-4">
            <div className="flex items-start gap-3">
              <span
                className={clsx(
                  'flex h-10 w-10 shrink-0 items-center justify-center rounded-xl',
                  TONE_ICON_CLASSES[pending.tone] ?? TONE_ICON_CLASSES.default
                )}
              >
                <Icon size={20} />
              </span>
              <div className="min-w-0 flex-1 pt-0.5">
                <h2 id="dialog-title" className="text-sm sm:text-base font-bold text-base-900 dark:text-white break-words">
                  {pending.title ?? (pending.mode === 'confirm' ? t('common.confirmTitle') : t('common.info'))}
                </h2>
                <div
                  id="dialog-message"
                  className="mt-1 text-xs sm:text-sm text-base-500 dark:text-base-300 leading-relaxed whitespace-pre-line break-words"
                >
                  {pending.message}
                </div>
              </div>
            </div>

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                ref={secondaryRef}
                variant="secondary"
                className="w-full sm:w-auto h-10 sm:h-9 text-xs sm:text-sm"
                onClick={() => close(false)}
              >
                {pending.secondaryLabel}
              </Button>
              <Button
                ref={primaryRef}
                variant={dangerous ? 'danger' : 'primary'}
                className="w-full sm:w-auto h-10 sm:h-9 text-xs sm:text-sm"
                onClick={() => close(true)}
              >
                {pending.primaryLabel}
              </Button>
            </div>
          </div>
        </div>
      </div>
    </DialogsContext.Provider>
  );
}
