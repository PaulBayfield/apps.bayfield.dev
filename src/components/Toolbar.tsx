// The top bar, laid out like Calendar's, Notes' and DevTime's: title on the left; account and
// page controls on the right; then the side panel toggle.

import { useRef, useState, type ReactNode } from "react";
import { useApp } from "../lib/app";
import { useSettings } from "../lib/settings";
import { Avatar } from "./common";
import { Dropdown as Floating } from "./pickers";
import { PanelLeft, PanelRight } from "./icons";

interface Props {
  title: ReactNode;
  loading?: boolean;
  children?: ReactNode;
}

export function Toolbar({ title, loading, children }: Props) {
  const { t } = useSettings();
  const { sidebarVisible, toggleSidebar, panelVisible, togglePanel } = useApp();
  return (
    <header className="toolbar">
      {!sidebarVisible && (
        <button className="icon-button" title={`${t("toggleSidebar")} (Ctrl+B)`} aria-label={t("toggleSidebar")} onClick={toggleSidebar}>
          <PanelLeft />
        </button>
      )}
      <h1 className="toolbar-title">{title}</h1>
      {loading && <span className="spinner" aria-label={t("loading")} />}
      <div className="toolbar-spacer" />
      <AccountMenu />
      {children}
      <button
        className={`icon-button panel-toggle${panelVisible ? " active" : ""}`}
        title={`${t("togglePanel")} (.)`}
        aria-label={t("togglePanel")}
        aria-pressed={panelVisible}
        onClick={togglePanel}
      >
        <PanelRight />
      </button>
    </header>
  );
}

function AccountMenu() {
  const { t } = useSettings();
  const { me, auth, openSettings, signIn, signOut } = useApp();
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLButtonElement>(null);

  if (!me) {
    if (!auth?.oidc && !auth?.dev) return null;
    return (
      <button className="primary-button" onClick={signIn}>
        {t("signIn")}
      </button>
    );
  }

  return (
    <div className="menu-anchor">
      <button ref={anchor} className="avatar-button" title={me.email || me.username} aria-haspopup="menu" aria-label={me.name || me.username} onClick={() => setOpen(!open)}>
        <Avatar name={me.name || me.username} src={me.avatar} />
      </button>
      {open && (
        <Floating anchor={anchor} onClose={() => setOpen(false)} className="menu-floating">
          <div className="menu" role="menu">
            <div className="menu-label">{me.email || me.username}</div>
            <button
              onClick={() => {
                setOpen(false);
                openSettings("account");
              }}
            >
              {t("account")}
            </button>
            <button
              onClick={() => {
                setOpen(false);
                openSettings("preferences");
              }}
            >
              <span>{t("settings")}</span>
              <span className="keys">
                <kbd>Ctrl</kbd> <kbd>,</kbd>
              </span>
            </button>
            <div className="menu-separator" />
            <button onClick={signOut}>{t("signOut")}</button>
          </div>
        </Floating>
      )}
    </div>
  );
}
