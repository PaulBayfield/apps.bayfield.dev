// Small pieces shared across pages.

import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import { useSettings } from "../lib/settings";
import { Check, Copy } from "./icons";

/** A button that opens a menu below it; closes on outside click and Escape. */
export function Dropdown({
  button,
  children,
  align = "right",
}: {
  button: (open: boolean, toggle: () => void) => ReactNode;
  children: (close: () => void) => ReactNode;
  align?: "left" | "right";
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);
  return (
    <div className="menu-anchor" ref={ref}>
      {button(open, () => setOpen((o) => !o))}
      {open && <div className={`menu${align === "left" ? " left" : ""}`}>{children(() => setOpen(false))}</div>}
    </div>
  );
}

export function Dialog({ title, onClose, children, wide }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);
  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-label={title} style={wide ? { width: "min(560px, 100%)" } : undefined}>
        <h2>{title}</h2>
        {children}
      </div>
    </div>
  );
}

// --- Toasts ---

type ToastFn = (message: string, kind?: "info" | "error") => void;
const ToastContext = createContext<ToastFn>(() => {});
export const useToast = () => useContext(ToastContext);

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toast, setToast] = useState<{ message: string; kind: "info" | "error"; id: number } | null>(null);
  const show = useCallback<ToastFn>((message, kind = "info") => setToast({ message, kind, id: Date.now() }), []);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), toast.kind === "error" ? 6000 : 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);
  return (
    <ToastContext.Provider value={show}>
      {children}
      {toast && (
        <div className={`toast${toast.kind === "error" ? " error" : ""}`} role="status" key={toast.id}>
          {toast.message}
        </div>
      )}
    </ToastContext.Provider>
  );
}

/** The Authentik avatar when there is one, else the first letter. */
export function Avatar({ name, src, size }: { name: string; src?: string | null; size?: number }) {
  const [broken, setBroken] = useState(false);
  const style = size ? { width: size, height: size, fontSize: size * 0.42 } : undefined;
  if (src && !broken) return <img className="avatar" src={src} alt="" style={style} onError={() => setBroken(true)} />;
  return (
    <span className="avatar" style={style} aria-hidden="true">
      {(name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}

export function CopyButton({ text, className = "icon-button small" }: { text: string; className?: string }) {
  const { t } = useSettings();
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      className={className}
      title={done ? t("copied") : t("copy")}
      aria-label={t("copy")}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true);
          window.setTimeout(() => setDone(false), 1500);
        });
      }}
    >
      {done ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

export function Spinner() {
  return <span className="spinner" aria-hidden="true" />;
}
