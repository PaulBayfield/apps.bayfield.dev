import { useEffect, useState, type ReactNode } from "react";
import { useApp, type SettingsPage } from "../lib/app";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { Info, Key, Keyboard, Shield, Sliders, UserIcon, X } from "./icons";
import { AccountPage, PasswordPage, SecurityPage } from "./settings/AccountPages";
import { AboutPage, PreferencesPage } from "./settings/AppPages";
import { PageHeader } from "./settings/common";
import { ShortcutList } from "./Shortcuts";
import { useUpdateCheck } from "../lib/updates";

export function SettingsDialog({ page: initialPage, onClose }: { page: SettingsPage; onClose: () => void }) {
  const { t } = useSettings();
  const { me } = useApp();
  const [page, setPage] = useState<SettingsPage>(initialPage);
  const updates = useUpdateCheck();
  const version = updates.status?.current ?? __APP_VERSION__;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && !document.querySelector(".dialog") && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const groups: { label: StringKey; items: { id: SettingsPage; label: StringKey; icon: ReactNode; page: () => ReactNode }[] }[] = [
    ...(me
      ? [
          {
            label: "account" as const,
            items: [
              { id: "account" as const, label: "account" as const, icon: <UserIcon />, page: () => <AccountPage go={setPage} /> },
              { id: "password" as const, label: "password" as const, icon: <Key />, page: () => <PasswordPage /> },
              { id: "security" as const, label: "twoFactorShort" as const, icon: <Shield />, page: () => <SecurityPage /> },
            ],
          },
        ]
      : []),
    {
      label: "settings",
      items: [
        { id: "preferences", label: "preferences", icon: <Sliders />, page: () => <PreferencesPage /> },
        { id: "shortcuts", label: "shortcuts", icon: <Keyboard />, page: () => <ShortcutsPage /> },
      ],
    },
    {
      label: "appName",
      items: [{ id: "about", label: "about", icon: <Info />, page: () => <AboutPage updates={updates} /> }],
    },
  ];
  const all = groups.flatMap((g) => g.items);
  const current = all.find((i) => i.id === page) ?? all[0];

  return (
    <div className="dialog-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="settings-modal" role="dialog" aria-label={t("settings")}>
        <nav className="settings-nav">
          {groups.map((g, i) => (
            <div key={g.label} style={{ display: "contents" }}>
              <div className={`settings-nav-label${i > 0 ? " spaced" : ""}`}>{t(g.label)}</div>
              {g.items.map((item) => (
                <button key={item.id} className={`settings-nav-item${current.id === item.id ? " active" : ""}`} onClick={() => setPage(item.id)}>
                  {item.icon}
                  <span>{t(item.label)}</span>
                </button>
              ))}
            </div>
          ))}
          <button className="settings-version" onClick={() => setPage("about")}>
            {t("version", { version })}
            {updates.status?.available && <span className="settings-version-update">{t("updateShort")}</span>}
          </button>
        </nav>
        <div className="settings-content">
          <button className="icon-button small settings-close" aria-label={t("close")} onClick={onClose}>
            <X />
          </button>
          <div className="settings-page" key={current.id}>
            {current.page()}
          </div>
        </div>
      </div>
    </div>
  );
}

function ShortcutsPage() {
  const { t } = useSettings();
  return (
    <>
      <PageHeader title={t("shortcuts")} />
      <ShortcutList />
    </>
  );
}
