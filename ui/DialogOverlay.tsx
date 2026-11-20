import React, { useEffect, useState } from "react";

export interface ToastMessage {
  id: number;
  text: string;
  variant?: "info" | "success" | "error";
}

export const ToastBanner: React.FC<{
  toast: ToastMessage | null;
  onDismiss: () => void;
}> = ({ toast, onDismiss }) => {
  if (!toast) return null;

  const palette =
    toast.variant === "error"
      ? "bg-red-950/95 border-red-500/60 text-red-100"
      : toast.variant === "success"
        ? "bg-green-950/95 border-green-500/60 text-green-100"
        : "bg-neutral-900/95 border-white/20 text-white";

  return (
    <div
      role="status"
      aria-live="polite"
      data-no-rebind
      className={`fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex items-center gap-3 px-4 py-2.5 rounded border shadow-2xl backdrop-blur text-xs md:text-sm font-mono pointer-events-auto ${palette}`}>
      <span>{toast.text}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss notification"
        className="text-white/60 hover:text-white font-bold px-1">
        ✕
      </button>
    </div>
  );
};

export const ConfirmDialog: React.FC<{
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}> = ({
  open,
  title,
  message,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  onConfirm,
  onCancel,
}) => {
  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      data-no-rebind
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 pointer-events-auto">
      <div className="w-full max-w-md bg-neutral-900 border border-white/15 rounded-lg p-6 shadow-2xl flex flex-col gap-4">
        <h3 className="text-lg font-black text-white uppercase tracking-tight">{title}</h3>
        <p className="text-sm text-neutral-300 leading-relaxed">{message}</p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs font-bold uppercase tracking-wider">
            {cancelLabel}
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className={`px-4 py-2 rounded text-xs font-bold uppercase tracking-wider ${
              danger
                ? "bg-red-600 hover:bg-red-500 text-white"
                : "bg-white hover:bg-neutral-200 text-black"
            }`}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export const JsonInputDialog: React.FC<{
  open: boolean;
  title: string;
  placeholder?: string;
  error?: string | null;
  onSubmit: (value: string) => void;
  onCancel: () => void;
}> = ({ open, title, placeholder = "Paste JSON here...", error, onSubmit, onCancel }) => {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (open) setValue("");
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onCancel();
      }
    };
    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      data-no-rebind
      role="dialog"
      aria-modal="true"
      className="fixed inset-0 z-[210] flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 pointer-events-auto">
      <div className="w-full max-w-xl bg-neutral-900 border border-white/15 rounded-lg p-6 shadow-2xl flex flex-col gap-4">
        <h3 className="text-lg font-black text-white uppercase tracking-tight">{title}</h3>
        <textarea
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={placeholder}
          rows={10}
          className="w-full bg-black/70 border border-white/15 rounded p-3 text-xs font-mono text-neutral-100 focus:border-blue-500 focus:outline-none resize-y"
        />
        {error && (
          <div className="text-xs font-mono text-red-300 bg-red-950/60 border border-red-500/40 rounded px-3 py-2">
            {error}
          </div>
        )}
        <div className="flex justify-end gap-3">
          <button
            type="button"
            onClick={onCancel}
            className="px-4 py-2 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded text-xs font-bold uppercase tracking-wider">
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onSubmit(value)}
            disabled={!value.trim()}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-40 text-white rounded text-xs font-bold uppercase tracking-wider">
            Load
          </button>
        </div>
      </div>
    </div>
  );
};
