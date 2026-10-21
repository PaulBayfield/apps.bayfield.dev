// Pieces shared by the settings pages (same layout as Calendar's, Notes' and DevTime's settings).

import type { ReactNode } from "react";

export function PageHeader({ title, hint }: { title: string; hint?: string }) {
  return (
    <header className="settings-page-header">
      <h2>{title}</h2>
      {hint && <p className="small muted">{hint}</p>}
    </header>
  );
}

/** A setting: its name and explanation on the left, the control on the right. */
export function Row({ label, hint, children, disabled, stack }: { label: ReactNode; hint?: ReactNode; children?: ReactNode; disabled?: boolean; stack?: boolean }) {
  return (
    <div className={`setting-row${disabled ? " disabled" : ""}${stack ? " stack" : ""}`}>
      <div className="setting-text">
        <span>{label}</span>
        {hint && <span className="settings-hint">{hint}</span>}
      </div>
      {children !== undefined && <div className="setting-control">{children}</div>}
    </div>
  );
}

export function Switch({ checked, onChange, disabled, label }: { checked: boolean; onChange: (on: boolean) => void; disabled?: boolean; label?: string }) {
  return <input type="checkbox" className="switch" checked={checked} disabled={disabled} aria-label={label} onChange={(e) => onChange(e.target.checked)} />;
}
