import React, { useEffect } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';

interface ConfirmDialogProps {
  open: boolean;
  title?: string;
  description?: ReactNode;
  confirmText?: string;
  cancelText?: string;
  tone?: 'danger' | 'default' | 'warning';
  onConfirm: () => void;
  onCancel: () => void;
  loading?: boolean;
}

// Tailwind-based animated modal with backdrop + scale / fade.
export const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title = 'Confirm Action',
  description,
  confirmText = 'Confirm',
  cancelText = 'Cancel',
  tone = 'default',
  onConfirm,
  onCancel,
  loading
}) => {
  useEffect(() => {
    if (open) {
      const prev = document.body.style.overflow;
      document.body.style.overflow = 'hidden';
      return () => { document.body.style.overflow = prev; };
    }
  }, [open]);

  if (!open) return null;

  const toneClasses = {
    default: 'bg-blue-600 hover:bg-blue-700 focus:ring-blue-500',
    warning: 'bg-amber-600 hover:bg-amber-700 focus:ring-amber-500',
    danger: 'bg-red-600 hover:bg-red-700 focus:ring-red-500'
  }[tone];

  return createPortal(
    <div className="fixed inset-0 z-[1000] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-slate-950/60 backdrop-blur-sm animate-fade-in" onClick={onCancel} />
      <div className="relative w-full max-w-sm origin-center rounded-xl bg-white dark:bg-slate-900 shadow-xl border border-slate-200/40 dark:border-slate-700/50 animate-pop">
        <div className="px-5 pt-5">
          <h2 className="text-sm font-semibold tracking-wide text-slate-800 dark:text-slate-100 flex items-center gap-2">
            {title}
          </h2>
          {description && (
            <div className="mt-2 text-xs leading-relaxed text-slate-600 dark:text-slate-300">
              {description}
            </div>
          )}
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 mt-4 bg-slate-50 dark:bg-slate-800/40 rounded-b-xl">
          <button
            type="button"
            disabled={loading}
            onClick={onCancel}
            className="inline-flex h-8 items-center rounded-md border border-slate-300 dark:border-slate-600 px-3 text-[11px] font-medium tracking-wide text-slate-700 dark:text-slate-200 hover:bg-white/60 dark:hover:bg-slate-700/60 focus:outline-none focus:ring-2 focus:ring-slate-400 disabled:opacity-50 disabled:cursor-not-allowed"
          >{cancelText}</button>
          <button
            type="button"
            disabled={loading}
            onClick={onConfirm}
            className={`inline-flex h-8 items-center rounded-md px-3 text-[11px] font-medium tracking-wide text-white focus:outline-none focus:ring-2 disabled:opacity-50 disabled:cursor-not-allowed ${toneClasses}`}
          >{loading ? '...' : confirmText}</button>
        </div>
      </div>
      <style>{`
        .animate-fade-in { animation: fade-in 160ms ease-out forwards; }
        .animate-pop { animation: pop-in 220ms cubic-bezier(.16,1,.3,1) forwards; transform: translateY(8px) scale(.96); opacity:0; }
        @keyframes fade-in { from { opacity:0; } to { opacity:1; } }
        @keyframes pop-in { to { opacity:1; transform:translateY(0) scale(1); } }
      `}</style>
    </div>,
    document.body
  );
};

export default ConfirmDialog;
