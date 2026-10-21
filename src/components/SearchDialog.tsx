// Ctrl+K / "/": the same command palette as Calendar's, Notes' and DevTime's. Opens an app, or
// jumps to a page, a category or a settings page.

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { hostOf } from "../lib/api";
import { byCategory, useApp, type SettingsPage } from "../lib/app";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { AppIcon } from "./AppIcon";
import { matches } from "./AppsPage";
import { Clock, Folder, Gear, LayoutGrid, Search } from "./icons";

interface Result {
  key: string;
  section: StringKey;
  title: string;
  extra?: string;
  icon: ReactNode;
  run: () => void;
}

export function SearchDialog({ onClose }: { onClose: () => void }) {
  const { t } = useSettings();
  const { apps, me, navigate, openSettings, launch } = useApp();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const q = query.trim().toLowerCase();

  const results = useMemo(() => {
    const keep = (title: string) => !q || title.toLowerCase().includes(q);
    const done = (fn: () => void) => () => {
      onClose();
      fn();
    };
    const out: Result[] = [];
    for (const a of (apps ?? []).filter((a) => matches(a, q)).slice(0, q ? 30 : 8)) {
      out.push({ key: `app:${a.id}`, section: "apps", title: a.name, extra: hostOf(a.url), icon: <AppIcon app={a} size={16} />, run: done(() => launch(a)) });
    }
    const pages: [StringKey, ReactNode, () => void][] = [
      ["home", <LayoutGrid size={16} />, () => navigate({ name: "home" })],
      ["recent", <Clock size={16} />, () => navigate({ name: "recent" })],
    ];
    for (const [label, icon, run] of pages) if (keep(t(label))) out.push({ key: `page:${label}`, section: "pages", title: t(label), icon, run: done(run) });
    if (q) {
      for (const [category, list] of byCategory(apps ?? []).filter(([c]) => c && keep(c))) {
        out.push({
          key: `category:${category}`,
          section: "categories",
          title: category,
          extra: String(list.length),
          icon: <Folder size={16} />,
          run: done(() => navigate({ name: "category", category })),
        });
      }
      const settings: { id: SettingsPage; label: StringKey }[] = [
        ...(me
          ? [
              { id: "account" as const, label: "account" as const },
              { id: "password" as const, label: "changePassword" as const },
              { id: "security" as const, label: "twoFactor" as const },
            ]
          : []),
        { id: "preferences", label: "preferences" },
        { id: "shortcuts", label: "shortcuts" },
        { id: "about", label: "about" },
      ];
      for (const s of settings.filter((s) => keep(t(s.label)))) {
        out.push({ key: `settings:${s.id}`, section: "settings", title: t(s.label), icon: <Gear size={16} />, run: done(() => openSettings(s.id)) });
      }
    }
    return out;
  }, [q, apps, me, t, navigate, openSettings, launch, onClose]);

  useEffect(() => setActive(0), [q]);
  useEffect(() => {
    listRef.current?.querySelector(".search-result.active")?.scrollIntoView({ block: "nearest" });
  }, [active]);

  let lastSection: StringKey | null = null;
  return (
    <div className="dialog-backdrop search-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="search-dialog" role="dialog" aria-label={t("search")}>
        <div className="search-input-row">
          <Search size={18} />
          <input
            autoFocus
            value={query}
            placeholder={t("searchPlaceholder")}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Escape") onClose();
              else if (e.key === "ArrowDown") setActive((i) => Math.min(results.length - 1, i + 1));
              else if (e.key === "ArrowUp") setActive((i) => Math.max(0, i - 1));
              else if (e.key === "Enter" && results[active]) results[active].run();
              else return;
              e.preventDefault();
              e.stopPropagation();
            }}
          />
        </div>
        <div className="search-results" ref={listRef}>
          {results.length === 0 && <p className="search-empty">{t("noResults")}</p>}
          {results.map((r, i) => {
            const header = r.section !== lastSection ? <div className="search-section">{t(r.section)}</div> : null;
            lastSection = r.section;
            return (
              <div key={r.key}>
                {header}
                <button className={`search-result${i === active ? " active" : ""}`} onMouseEnter={() => setActive(i)} onClick={r.run}>
                  <span className="search-result-icon">{r.icon}</span>
                  <span className="search-result-text">
                    <span className="search-result-title">{r.title}</span>
                  </span>
                  {r.extra && <span className="search-result-when">{r.extra}</span>}
                </button>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
