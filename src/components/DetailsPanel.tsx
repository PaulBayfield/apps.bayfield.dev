// The side panel on the right (like Calendar's event panel and DevTime's filters): the selected
// app's details, or, with none selected, the access and category filters. Toggled with "."
// or the button at the end of the toolbar.

import { useMemo, type ReactNode } from "react";
import { hostOf, type App, type AppAccess } from "../lib/api";
import { byCategory, useApp } from "../lib/app";
import { useApi } from "../lib/hooks";
import { recordOpened, useFavorites, useRecent } from "../lib/local";
import { useSettings } from "../lib/settings";
import type { StringKey } from "../lib/i18n";
import { AppIcon } from "./AppIcon";
import { CopyButton } from "./common";
import { Check, ChevronLeft, ExternalLink, Globe, Lock, Shield, Star, UserIcon, Users, X } from "./icons";

export function DetailsPanel() {
  const { t } = useSettings();
  const { apps, query, select, togglePanel } = useApp();
  const app = query.app ? apps?.find((a) => a.id === query.app) : undefined;

  return (
    <aside className="panel">
      <div className="panel-header">
        {app && (
          <button className="icon-button" style={{ marginLeft: -6 }} aria-label={t("filters")} title={t("filters")} onClick={() => select(undefined)}>
            <ChevronLeft />
          </button>
        )}
        <span className="panel-label">{app ? t("details") : t("filters")}</span>
        <div className="toolbar-spacer" />
        <button className="icon-button" aria-label={t("close")} title={`${t("close")} (.)`} onClick={togglePanel}>
          <X />
        </button>
      </div>
      <div className="panel-body">{app ? <AppDetails app={app} /> : <Filters />}</div>
    </aside>
  );
}

function AppDetails({ app }: { app: App }) {
  const { t, f } = useSettings();
  const { targetOf } = useApp();
  const favorites = useFavorites();
  const recent = useRecent();
  const fav = favorites.has(app.id);
  const opened = recent.entries.find((e) => e.id === app.id);

  return (
    <>
      <section className="panel-section details-head">
        <AppIcon app={app} size={56} />
        <h2>{app.name}</h2>
        {app.description && <p className="muted">{app.description}</p>}
        <div className="details-actions">
          <a className="primary-button" href={app.url} target={targetOf(app)} rel="noopener noreferrer" onClick={() => recordOpened(app.id)}>
            {t("open")}
            {targetOf(app) && <ExternalLink size={14} />}
          </a>
          <button className={`text-button${fav ? " starred" : ""}`} aria-pressed={fav} onClick={() => favorites.toggle(app.id)}>
            <Star size={14} filled={fav} />
            {fav ? t("removeFavorite") : t("addFavorite")}
          </button>
        </div>
      </section>
      <section className="panel-section">
        <DetailRow label={t("address")}>
          <span className="details-url">
            <a href={app.url} target="_blank" rel="noopener noreferrer">
              {hostOf(app.url)}
            </a>
            <CopyButton text={app.url} />
          </span>
        </DetailRow>
        <DetailRow label={t("access")}>
          {app.access === "private" ? (
            <span className="badge">
              <Lock size={11} /> {t("private")}
            </span>
          ) : (
            <span className="badge good">
              <Globe size={11} /> {t("public")}
            </span>
          )}
        </DetailRow>
        {app.category && <DetailRow label={t("category")}>{app.category}</DetailRow>}
        {app.publisher && <DetailRow label={t("publisher")}>{app.publisher}</DetailRow>}
        {opened && <DetailRow label={t("recent")}>{f.relative(opened.at, t)}</DetailRow>}
      </section>
      {app.access === "private" && <AccessSection app={app} />}
    </>
  );
}

/** Which of the user's groups (or what else) give them access, from the app's bindings in Authentik. */
function AccessSection({ app }: { app: App }) {
  const { t } = useSettings();
  const { data, error } = useApi<AppAccess>(`/apps/access?id=${encodeURIComponent(app.id)}`);
  const none = data && !data.everyone && !data.user && data.groups.length === 0 && data.policies.length === 0;
  const ruleCount = data ? data.groups.length + data.policies.length + (data.user ? 1 : 0) : 0;

  return (
    <section className="panel-section">
      <div className="panel-subtitle">{t("yourAccess")}</div>
      {!data ? (
        error ? <p className="small muted">{t("accessUnavailable")}</p> : <div className="skeleton" style={{ height: 52 }} />
      ) : (
        <div className="access-list">
          {data.everyone && (
            <AccessItem icon={<Globe size={14} />} label={t("accessEveryone")} />
          )}
          {data.groups.map((g) => (
            <AccessItem key={g.name} icon={<Users size={14} />} label={g.name} hint={g.via ? t("accessVia", { group: g.via }) : t("accessGroup")} />
          ))}
          {data.user && <AccessItem icon={<UserIcon size={14} />} label={t("accessDirect")} hint={t("accessDirectHint")} />}
          {data.policies.map((p) => (
            <AccessItem key={p} icon={<Shield size={14} />} label={p} hint={t("accessPolicy")} />
          ))}
          {none && <p className="small muted">{t("accessUnknown")}</p>}
          {data.mode === "all" && ruleCount > 1 && <p className="small muted">{t("accessAll")}</p>}
        </div>
      )}
    </section>
  );
}

function AccessItem({ icon, label, hint }: { icon: ReactNode; label: string; hint?: string }) {
  return (
    <div className="access-item">
      <span className="access-icon">{icon}</span>
      <span className="access-text">
        <span className="access-label">{label}</span>
        {hint && <span className="small muted">{hint}</span>}
      </span>
    </div>
  );
}

function DetailRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  );
}

function Filters() {
  const { t } = useSettings();
  const { apps, me, query, setQuery, navigate, route } = useApp();
  const access = query.access ?? "";
  const counts = useMemo(() => {
    const list = apps ?? [];
    return { "": list.length, public: list.filter((a) => a.access === "public").length, private: list.filter((a) => a.access === "private").length };
  }, [apps]);
  const categories = useMemo(() => byCategory(apps ?? []).filter(([c]) => c), [apps]);
  const options: { id: "" | "public" | "private"; label: StringKey; hint?: StringKey }[] = [
    { id: "", label: "all" },
    { id: "public", label: "public", hint: "publicHint" },
    ...(me ? [{ id: "private" as const, label: "private" as const, hint: "privateHint" as const }] : []),
  ];

  return (
    <>
      <section className="panel-section">
        <div className="panel-subtitle">{t("access")}</div>
        <div className="filter-options">
          {options.map((o) => {
            const on = access === o.id;
            return (
              <button key={o.id} className={`filter-option${on ? " active" : ""}`} aria-pressed={on} title={o.hint && t(o.hint)} onClick={() => setQuery({ access: o.id || undefined })}>
                <span className="filter-check">{on && <Check size={12} />}</span>
                <span className="filter-name">{t(o.label)}</span>
                <span className="filter-time">{counts[o.id]}</span>
              </button>
            );
          })}
        </div>
      </section>
      {categories.length > 0 && (
        <section className="panel-section">
          <div className="panel-subtitle">{t("categories")}</div>
          <div className="filter-options">
            {categories.map(([category, list]) => {
              const on = route.name === "category" && route.category === category;
              return (
                <button
                  key={category}
                  className={`filter-option${on ? " active" : ""}`}
                  aria-pressed={on}
                  onClick={() => navigate(on ? { name: "home" } : { name: "category", category })}
                >
                  <span className="filter-check">{on && <Check size={12} />}</span>
                  <span className="filter-name">{category}</span>
                  <span className="filter-time">{list.length}</span>
                </button>
              );
            })}
          </div>
        </section>
      )}
      <section className="panel-section">
        <p className="small muted">{t("selectAppHint")}</p>
      </section>
    </>
  );
}
