// Admin → App access: every application in Authentik and the active accounts that can open it, as
// cards per app or as a people × apps table. The side panel shows one app's rules and everyone it
// lets in, with what lets each of them in.

import { useMemo, type ReactNode } from "react";
import type { AccessApp, AccessGrant, AccessUser, AdminAccess } from "../../lib/api";
import { useApp } from "../../lib/app";
import { useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import type { Translate } from "../../lib/i18n";
import { AppIcon } from "../AppIcon";
import { Avatar } from "../common";
import { Check, ExternalLink, Globe, Shield, UserIcon, Users } from "../icons";
import { UserCell, Warnings } from "./shared";

/** What lets `g` in: the bound groups, a binding naming them, else everyone or a policy. */
export function reasonOf(g: AccessGrant, app: AccessApp, t: Translate): string {
  const parts = g.groups.map((x) => (x.via ? t("accessThroughChild", { group: x.name, via: x.via }) : t("accessThrough", { group: x.name })));
  if (g.direct) parts.push(t("accessDirectUser"));
  if (parts.length) return parts.join(" · ");
  return app.rules?.everyone ? t("accessEveryone") : t("accessByPolicy");
}

const hostOf = (url: string | null) => {
  try {
    return url ? new URL(url).host : "";
  } catch {
    return "";
  }
};

/** Selects an app (?slug=) and shows it in the side panel. */
function useSelectApp() {
  const { setQuery, panelVisible, togglePanel } = useApp();
  return (slug: string | undefined) => {
    setQuery({ slug, user: undefined }, true);
    if (slug && !panelVisible) togglePanel();
  };
}

/** The apps and people left by the filter: an app matching it keeps everyone, else only matching people. */
function useFiltered(data: AdminAccess | undefined, q: string) {
  return useMemo(() => {
    const byPk = new Map((data?.users ?? []).map((u) => [u.pk, u]));
    const userMatch = (u: AccessUser | undefined) => !!u && `${u.name} ${u.username} ${u.email} ${u.groups.join(" ")}`.toLowerCase().includes(q);
    const appMatch = (a: AccessApp) => `${a.name} ${a.slug} ${a.category} ${hostOf(a.url)} ${a.rules?.groups.join(" ") ?? ""}`.toLowerCase().includes(q);
    const apps = (data?.apps ?? [])
      .map((a) => (!q || appMatch(a) ? a : { ...a, users: a.users?.filter((g) => userMatch(byPk.get(g.pk))) ?? null }))
      .filter((a) => !q || appMatch(a) || (a.users?.length ?? 0) > 0);
    const users = (data?.users ?? []).filter((u) => !q || userMatch(u));
    return { apps, users: q && users.length === 0 ? (data?.users ?? []) : users, byPk };
  }, [data, q]);
}

export function AccessView() {
  const { t, f } = useSettings();
  const { query, setQuery, server } = useApp();
  const { data, error } = useApi<AdminAccess>("/admin/access");
  const q = (query.q ?? "").trim().toLowerCase();
  const view = query.view === "table" ? "table" : "apps";
  const { apps, users, byPk } = useFiltered(data, q);

  if (!data) return error ? <p className="error-text">{error}</p> : <div className="skeleton" style={{ height: 420 }} />;
  const name = server?.oidc?.name ?? "Authentik";

  return (
    <>
      <Warnings warnings={data.warnings} />
      <div className="access-head">
        <p className="small muted">
          {t("adminAccessHint", { name })} {t("accessSummary", { apps: f.number(data.apps.length), users: f.number(data.users.length) })}
        </p>
        <div className="segmented" role="group" aria-label={t("adminAccess")}>
          {(
            [
              ["apps", "viewByApp"],
              ["table", "viewTable"],
            ] as const
          ).map(([id, label]) => (
            <button key={id} className={view === id ? "active" : ""} aria-pressed={view === id} onClick={() => setQuery({ view: id === "apps" ? undefined : id }, true)}>
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      {apps.length === 0 ? (
        <p className="table-empty">{t("noAppsMatch")}</p>
      ) : view === "table" ? (
        <AccessTable apps={apps} users={users} />
      ) : (
        <div className="access-cards">
          {apps.map((a) => (
            <AppCard key={a.slug} app={a} byPk={byPk} />
          ))}
        </div>
      )}
      {data.adminUrl && (
        <p className="small faint">
          <a className="link-button" href={data.adminUrl} target="_blank" rel="noopener noreferrer">
            {t("appsInAuthentik", { name })} <ExternalLink size={12} />
          </a>
        </p>
      )}
    </>
  );
}

/** Bound groups, policies and direct grants, as short chips. */
function RuleChips({ app, byPk }: { app: AccessApp; byPk: Map<number, AccessUser> }) {
  const { t } = useSettings();
  const r = app.rules;
  if (!r) return <span className="rule-chip muted">{t("accessRulesUnknown")}</span>;
  if (r.everyone) return <span className="rule-chip everyone">{t("accessEveryoneShort")}</span>;
  return (
    <>
      {r.groups.map((g) => (
        <span key={`g:${g}`} className="rule-chip" title={t("accessGroup")}>
          <Users size={11} />
          {g}
        </span>
      ))}
      {r.users.map((pk) => (
        <span key={`u:${pk}`} className="rule-chip" title={t("accessDirectUser")}>
          <UserIcon size={11} />
          {byPk.get(pk)?.username ?? `#${pk}`}
        </span>
      ))}
      {r.policies.map((p) => (
        <span key={`p:${p}`} className="rule-chip policy" title={t("accessPolicy")}>
          <Shield size={11} />
          {p}
        </span>
      ))}
    </>
  );
}

function AppCard({ app, byPk }: { app: AccessApp; byPk: Map<number, AccessUser> }) {
  const { t } = useSettings();
  const { query, selectUser } = useApp();
  const selectApp = useSelectApp();
  const selected = query.slug === app.slug;
  const n = app.users?.length ?? null;

  return (
    <article className={`access-card${selected ? " selected" : ""}`}>
      <button className="access-card-head" onClick={() => selectApp(selected ? undefined : app.slug)} aria-pressed={selected}>
        <AppIcon app={app} size={32} />
        <span className="access-card-title">
          <span className="access-card-name">{app.name}</span>
          <span className="access-card-sub">
            {app.url ? hostOf(app.url) : <span className="badge" title={t("accessNoLaunchHint")}>{t("accessNoLaunch")}</span>}
            {app.category && ` · ${app.category}`}
          </span>
        </span>
        {n !== null && <span className="access-card-count">{n === 1 ? t("oneUser") : t("nUsers", { n })}</span>}
      </button>
      <div className="rule-chips">
        <RuleChips app={app} byPk={byPk} />
      </div>
      {app.users && (
        <div className="person-chips">
          {app.users.length === 0 && <span className="small faint">{t("accessNobody")}</span>}
          {app.users.map((g) => {
            const u = byPk.get(g.pk);
            if (!u) return null;
            return (
              <button key={g.pk} className="person-chip" title={`${u.name || u.username} · ${reasonOf(g, app, t)}`} onClick={() => selectUser(g.pk)}>
                <Avatar name={u.name || u.username} src={u.avatar} size={18} />
                <span>{u.name || u.username}</span>
              </button>
            );
          })}
        </div>
      )}
    </article>
  );
}

/** People down the side, apps across the top, a tick where they can open it. */
function AccessTable({ apps, users }: { apps: AccessApp[]; users: AccessUser[] }) {
  const { t } = useSettings();
  const { query, selectUser } = useApp();
  const selectApp = useSelectApp();
  const grants = useMemo(() => new Map(apps.map((a) => [a.slug, new Map((a.users ?? []).map((g) => [g.pk, g]))])), [apps]);

  return (
    <div className="table-wrap">
      <table className="admin-table access-table">
        <thead>
          <tr>
            <th className="sticky-col">{t("colUser")}</th>
            {apps.map((a) => (
              <th key={a.slug} className={`access-col${query.slug === a.slug ? " selected" : ""}`} title={a.name}>
                <button className="access-col-head" onClick={() => selectApp(a.slug)}>
                  <AppIcon app={a} size={20} />
                  <span>{a.name}</span>
                </button>
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {users.map((u) => (
            <tr key={u.pk} className={query.user === String(u.pk) ? "selected" : ""} onClick={() => selectUser(u.pk)}>
              <td className="sticky-col">
                <UserCell name={u.name} username={u.username} avatar={u.avatar} />
              </td>
              {apps.map((a) => {
                const g = grants.get(a.slug)?.get(u.pk);
                const label = g ? `${t("accessCanOpen", { user: u.name || u.username, app: a.name })} · ${reasonOf(g, a, t)}` : undefined;
                return (
                  <td key={a.slug} className={`access-cell${query.slug === a.slug ? " selected" : ""}`} title={label}>
                    {a.users === null ? <span className="faint">?</span> : g ? <Check size={15} aria-label={label} /> : <span className="faint" aria-hidden="true">·</span>}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// --- Side panel ---

export function AppAccessDetails({ slug }: { slug: string }) {
  const { t } = useSettings();
  const { server, selectUser } = useApp();
  const { data, error } = useApi<AdminAccess>("/admin/access");
  const app = data?.apps.find((a) => a.slug === slug);
  const byPk = useMemo(() => new Map((data?.users ?? []).map((u) => [u.pk, u])), [data]);

  if (!data || !app) {
    return (
      <section className="panel-section">
        {error ? <p className="error-text">{error}</p> : data ? <p className="small muted">{t("noAppsMatch")}</p> : <div className="skeleton" style={{ height: 160 }} />}
      </section>
    );
  }
  const r = app.rules;
  const ruleCount = r ? r.groups.length + r.users.length + r.policies.length : 0;

  return (
    <>
      <section className="panel-section details-head">
        <AppIcon app={app} size={56} />
        <h2>{app.name}</h2>
        <p className="muted">{app.url ? hostOf(app.url) : t("accessNoLaunchHint")}</p>
        <div className="details-actions">
          {app.url && (
            <a className="text-button" href={app.url} target="_blank" rel="noopener noreferrer">
              {t("open")}
              <ExternalLink size={14} />
            </a>
          )}
          {data.adminUrl && (
            <a className="text-button" href={`${data.adminUrl}/${encodeURIComponent(app.slug)}`} target="_blank" rel="noopener noreferrer">
              {t("openInAuthentik", { name: server?.oidc?.name ?? "Authentik" })}
              <ExternalLink size={14} />
            </a>
          )}
        </div>
      </section>

      <section className="panel-section">
        <div className="panel-subtitle">{t("accessRules")}</div>
        {!r ? (
          <p className="small muted">{t("accessRulesUnknown")}</p>
        ) : (
          <div className="access-list">
            {r.everyone && <Rule icon={<Globe size={14} />} label={t("accessEveryone")} />}
            {r.groups.map((g) => (
              <Rule key={g} icon={<Users size={14} />} label={g} hint={t("accessGroup")} />
            ))}
            {r.users.map((pk) => (
              <Rule key={pk} icon={<UserIcon size={14} />} label={byPk.get(pk)?.name || byPk.get(pk)?.username || `#${pk}`} hint={t("accessDirectUser")} />
            ))}
            {r.policies.map((p) => (
              <Rule key={p} icon={<Shield size={14} />} label={p} hint={t("accessPolicy")} />
            ))}
            {app.mode === "all" && ruleCount > 1 && <p className="small muted">{t("accessAll")}</p>}
          </div>
        )}
      </section>

      {app.users && (
        <section className="panel-section">
          <div className="panel-subtitle">
            {t("accessWho")} <span className="faint">{app.users.length}</span>
          </div>
          {app.users.length === 0 ? (
            <p className="small faint">{t("accessNobody")}</p>
          ) : (
            <div className="access-people">
              {app.users.map((g) => {
                const u = byPk.get(g.pk);
                if (!u) return null;
                return (
                  <button key={g.pk} className="access-person" onClick={() => selectUser(g.pk)}>
                    <UserCell name={u.name} username={u.username} avatar={u.avatar} sub={reasonOf(g, app, t)} />
                  </button>
                );
              })}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function Rule({ icon, label, hint }: { icon: ReactNode; label: string; hint?: string }) {
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
