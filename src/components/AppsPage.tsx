// The main view: every app the visitor can open, as cards grouped by category (or one category,
// or the recently opened ones). Filtered by the toolbar field and the panel's access filter.

import { useMemo, useRef, type ReactNode } from "react";
import { hostOf, type App } from "../lib/api";
import { byCategory, useApp } from "../lib/app";
import { recordOpened, useFavorites, useRecent } from "../lib/local";
import { useSettings } from "../lib/settings";
import { AppIcon } from "./AppIcon";
import { Clock, Info, Lock, Refresh, Search, Star, X } from "./icons";
import { Toolbar } from "./Toolbar";

/** Matches the name, address, description, category or publisher. */
export function matches(app: App, q: string): boolean {
  if (!q) return true;
  const hay = `${app.name} ${hostOf(app.url)} ${app.description} ${app.category} ${app.publisher}`.toLowerCase();
  return q
    .toLowerCase()
    .split(/\s+/)
    .every((w) => hay.includes(w));
}

export function AppsPage({ favorites }: { favorites: App[] }) {
  const { t } = useSettings();
  const { route, navigate, apps, appsError, appsLoading, query, setQuery, me, refreshApps } = useApp();
  const recent = useRecent();
  const filterRef = useRef<HTMLInputElement>(null);
  const q = query.q?.trim() ?? "";
  const access = query.access === "public" || query.access === "private" ? query.access : null;

  const visible = useMemo(
    () => (apps ?? []).filter((a) => (!access || a.access === access) && matches(a, q) && (route.name !== "category" || a.category === route.category)),
    [apps, access, q, route],
  );
  const filtering = !!q || !!access;

  const title =
    route.name === "recent" ? (
      t("recent")
    ) : route.name === "category" ? (
      <>
        <button className="crumb" onClick={() => navigate({ name: "home" })}>
          {t("home")}
        </button>
        <span className="crumb-sep">/</span>
        <span>{route.category || t("other")}</span>
      </>
    ) : (
      t("home")
    );

  return (
    <>
      <Toolbar title={title} loading={appsLoading && !!apps}>
        <div className="search-field hide-mobile">
          <Search size={14} />
          <input
            ref={filterRef}
            className="text-field"
            placeholder={t("filterApps")}
            aria-label={t("filterApps")}
            value={query.q ?? ""}
            onChange={(e) => setQuery({ q: e.target.value }, true)}
            onKeyDown={(e) => {
              if (e.key === "Escape") {
                setQuery({ q: undefined }, true);
                filterRef.current?.blur();
              }
            }}
          />
          {query.q && (
            <button className="icon-button small search-clear" aria-label={t("close")} onClick={() => setQuery({ q: undefined }, true)}>
              <X size={13} />
            </button>
          )}
        </div>
        {me && (
          <button className="icon-button hide-mobile" title={t("refresh")} aria-label={t("refresh")} onClick={refreshApps}>
            <Refresh />
          </button>
        )}
      </Toolbar>
      <div className="content">
        <div className="page">
          {!me && route.name === "home" && <SignInPrompt />}
          {appsError && !apps && <p className="error-text">{t("appsError", { error: appsError })}</p>}
          {!apps ? (
            <AppGridSkeleton />
          ) : route.name === "recent" ? (
            <RecentList apps={visible} entries={recent.entries} onClear={recent.clear} />
          ) : visible.length === 0 ? (
            <Empty title={q ? t("noMatches", { q }) : t("noApps")} hint={q ? undefined : t("noAppsHint")} />
          ) : route.name === "category" ? (
            <AppGrid apps={visible} />
          ) : (
            <>
              {!filtering && favorites.length > 0 && <AppSection title={t("favorites")} apps={favorites} />}
              {byCategory(visible).map(([category, list]) => (
                <AppSection
                  key={category}
                  title={category || t("other")}
                  apps={list}
                  onTitle={category && !filtering ? () => navigate({ name: "category", category }) : undefined}
                />
              ))}
            </>
          )}
        </div>
      </div>
    </>
  );
}

function SignInPrompt() {
  const { t } = useSettings();
  const { auth, signIn } = useApp();
  if (!auth?.oidc && !auth?.dev) return null;
  return (
    <div className="signin-prompt">
      <span className="signin-prompt-icon">
        <Lock size={18} />
      </span>
      <p>{t("signInPrompt")}</p>
      <button className="primary-button" onClick={signIn}>
        {auth.oidc ? t("signInWith", { name: auth.oidc.name }) : t("devSignIn")}
      </button>
    </div>
  );
}

function AppSection({ title, apps, onTitle }: { title: string; apps: App[]; onTitle?: () => void }) {
  return (
    <section className="app-section">
      <h2 className="section-title">
        {onTitle ? (
          <button className="section-link" onClick={onTitle}>
            {title}
          </button>
        ) : (
          title
        )}
        <span className="section-count">{apps.length}</span>
      </h2>
      <AppGrid apps={apps} />
    </section>
  );
}

function AppGrid({ apps }: { apps: App[] }) {
  return (
    <div className="app-grid">
      {apps.map((a) => (
        <AppCard key={a.id} app={a} />
      ))}
    </div>
  );
}

export function AppCard({ app, meta }: { app: App; meta?: string }) {
  const { t, settings } = useSettings();
  const { targetOf, select, query } = useApp();
  const favorites = useFavorites();
  const fav = favorites.has(app.id);
  const target = targetOf(app);
  return (
    <div className={`app-card${query.app === app.id ? " selected" : ""}`}>
      <a
        className="app-card-link"
        href={app.url}
        target={target}
        rel="noopener noreferrer"
        title={target ? `${app.name} · ${t("openInNewTab")}` : app.name}
        onClick={() => recordOpened(app.id)}
        onAuxClick={(e) => e.button === 1 && recordOpened(app.id)}
      >
        <AppIcon app={app} />
        <span className="app-card-text">
          <span className="app-card-name">
            <span>{app.name}</span>
            {app.access === "private" && (
              <span className="app-card-lock" title={t("private")}>
                <Lock size={12} />
              </span>
            )}
          </span>
          <span className="app-card-host">{meta ?? hostOf(app.url)}</span>
          {settings.descriptions && app.description && <span className="app-card-desc">{app.description}</span>}
        </span>
      </a>
      <div className="app-card-actions">
        <button
          className={`icon-button small${fav ? " starred" : ""}`}
          title={fav ? t("removeFavorite") : t("addFavorite")}
          aria-label={fav ? t("removeFavorite") : t("addFavorite")}
          aria-pressed={fav}
          onClick={() => favorites.toggle(app.id)}
        >
          <Star size={14} filled={fav} />
        </button>
        <button className="icon-button small" title={t("showDetails")} aria-label={t("showDetails")} onClick={() => select(query.app === app.id ? undefined : app.id)}>
          <Info size={14} />
        </button>
      </div>
    </div>
  );
}

function RecentList({ apps, entries, onClear }: { apps: App[]; entries: { id: string; at: number }[]; onClear: () => void }) {
  const { t, f } = useSettings();
  const shown = entries.map((e) => ({ e, app: apps.find((a) => a.id === e.id) })).filter((x): x is { e: { id: string; at: number }; app: App } => !!x.app);
  if (shown.length === 0) return <Empty title={t("noRecent")} hint={t("noRecentHint")} icon={<Clock size={28} />} />;
  return (
    <section className="app-section">
      <h2 className="section-title">
        {t("recent")}
        <span className="section-count">{shown.length}</span>
        <span className="toolbar-spacer" />
        <button className="link-button" onClick={onClear}>
          {t("clearRecent")}
        </button>
      </h2>
      <div className="app-grid">
        {shown.map(({ e, app }) => (
          <AppCard key={app.id} app={app} meta={t("openedAt", { when: f.relative(e.at, t) })} />
        ))}
      </div>
    </section>
  );
}

function Empty({ title, hint, icon }: { title: string; hint?: string; icon?: ReactNode }) {
  return (
    <div className="empty-state">
      {icon}
      <h2>{title}</h2>
      {hint && <p className="small">{hint}</p>}
    </div>
  );
}

function AppGridSkeleton() {
  return (
    <section className="app-section">
      <div className="skeleton" style={{ width: 120, height: 16 }} />
      <div className="app-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 92 }} />
        ))}
      </div>
    </section>
  );
}
