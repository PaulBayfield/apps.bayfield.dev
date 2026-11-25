// The admin pages (Authentik superusers only): an overview of accounts and usage, every user, and
// the event log. All read from Authentik through the server; changes are made in Authentik itself.

import { useMemo, useRef, useState, type ReactNode } from "react";
import type { AdminEvents, AdminOverview, AdminUserRow, AdminUsers, DayPoint, MfaSummary } from "../../lib/api";
import { useApp } from "../../lib/app";
import { useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import { useToast } from "../common";
import { ChevronDown, ChevronUp, Refresh, Search, X } from "../icons";
import { Toolbar } from "../Toolbar";
import { AppIcon } from "../AppIcon";
import { BarList, DayBars, EventRow, PeriodPicker, UserCell, Warnings, countryName, flag, refreshAdmin, usePeriod } from "./shared";
import { AccessView } from "./AccessPage";

export function AdminPage() {
  const { t } = useSettings();
  const { route, query, setQuery } = useApp();
  const toast = useToast();
  const { params } = usePeriod();
  const tab = route.name === "admin" ? route.tab : "overview";
  const [nonce, setNonce] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const filterRef = useRef<HTMLInputElement>(null);
  const filterable = tab !== "overview";

  const refresh = () => {
    setRefreshing(true);
    refreshAdmin(params, tab).then(
      () => {
        setRefreshing(false);
        setNonce((n) => n + 1);
      },
      (e: Error) => {
        setRefreshing(false);
        toast(e.message, "error");
      },
    );
  };

  const title = <>{t(tab === "users" ? "adminUsers" : tab === "access" ? "adminAccess" : tab === "activity" ? "adminActivity" : "adminOverview")}</>;
  const filterLabel = t(tab === "users" ? "filterUsers" : tab === "access" ? "filterAccess" : "filterEvents");

  return (
    <>
      <Toolbar title={title} loading={refreshing}>
        {filterable && (
          <div className="search-field hide-mobile">
            <Search size={14} />
            <input
              ref={filterRef}
              className="text-field"
              placeholder={filterLabel}
              aria-label={filterLabel}
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
        )}
        {tab !== "access" && <PeriodPicker />}
        <button className="icon-button hide-mobile" title={t("refresh")} aria-label={t("refresh")} onClick={refresh} disabled={refreshing}>
          <Refresh />
        </button>
      </Toolbar>
      <div className="content">
        <div className="page admin-page" key={nonce}>
          {tab === "overview" ? <Overview /> : tab === "users" ? <UsersTable /> : tab === "access" ? <AccessView /> : <Activity />}
        </div>
      </div>
    </>
  );
}

// --- Overview ---

type Metric = "logins" | "users" | "appOpens" | "failed";
const METRICS: { id: Metric; label: StringKey; value: (p: DayPoint) => number }[] = [
  { id: "logins", label: "kpiSignIns", value: (p) => p.logins },
  { id: "users", label: "kpiActive", value: (p) => p.users },
  { id: "appOpens", label: "kpiAppOpens", value: (p) => p.appOpens },
  { id: "failed", label: "kpiFailed", value: (p) => p.failed },
];

function Overview() {
  const { t, f } = useSettings();
  const { server, navigate, selectUser } = useApp();
  const { days, params } = usePeriod();
  const { data, error } = useApi<AdminOverview>(`/admin/overview?${params}`);
  const [metric, setMetric] = useState<Metric>("logins");

  if (!data) return error ? <p className="error-text">{error}</p> : <OverviewSkeleton />;
  const u = data.users;
  const noEvents = data.warnings.includes("events");
  const m = METRICS.find((x) => x.id === metric)!;
  const pct = (n: number) => (u.active ? Math.round((n / u.active) * 100) : 0);
  const avg = (n: number) => f.number(Math.round((n / days) * 10) / 10);

  return (
    <>
      <Warnings warnings={data.warnings} truncated={data.truncated} />
      <div className="kpi-grid">
        <Kpi label={t("kpiAccounts")} value={f.number(u.total)} hint={t("kpiAccountsHint", { active: f.number(u.active), inactive: f.number(u.inactive) })} foot={u.joinedInRange ? t("newAccounts", { n: u.joinedInRange }) : undefined} />
        {!noEvents && <Kpi label={t("kpiActive")} value={f.number(data.totals.activeUsers)} hint={t("kpiActiveHint")} foot={t("ofAccounts", { n: pct(data.totals.activeUsers) })} />}
        {!noEvents && <Kpi label={t("kpiSignIns")} value={f.number(data.totals.logins)} hint={t("perDay", { n: avg(data.totals.logins) })} />}
        {!noEvents && <Kpi label={t("kpiAppOpens")} value={f.number(data.totals.appOpens)} hint={t("perDay", { n: avg(data.totals.appOpens) })} />}
        {!noEvents && <Kpi label={t("kpiFailed")} value={f.number(data.totals.failed)} hint={t("perDay", { n: avg(data.totals.failed) })} />}
        {u.withMfa !== null && <Kpi label={t("kpiMfa")} value={`${pct(u.withMfa)} %`} hint={t("kpiMfaHint", { n: f.number(u.withMfa), total: f.number(u.active) })} meter={pct(u.withMfa)} />}
      </div>

      {!noEvents && (
        <Card
          title={t("activityChart")}
          action={
            <div className="segmented" role="group" aria-label={t("activityChart")}>
              {METRICS.map((x) => (
                <button key={x.id} className={metric === x.id ? "active" : ""} aria-pressed={metric === x.id} onClick={() => setMetric(x.id)}>
                  {t(x.label)}
                </button>
              ))}
            </div>
          }
        >
          <DayBars points={data.series} value={m.value} label={`${t(m.label)} · ${t("lastNDays", { n: days })}`} />
        </Card>
      )}

      <div className="card-grid">
        {!noEvents && (
          <Card title={t("appUsage")} hint={t("appUsageHint", { name: server?.oidc?.name ?? "Authentik" })}>
            <BarList
              rows={data.apps.map((a) => ({
                key: a.name,
                label: (
                  <>
                    <AppIcon app={a} size={18} />
                    {a.name}
                  </>
                ),
                meta: a.users === 1 ? t("oneUser") : t("nUsers", { n: a.users }),
                value: a.opens,
              }))}
            />
          </Card>
        )}
        {!noEvents && (
          <Card title={t("topUsers")} action={<button className="link-button" onClick={() => navigate({ name: "admin", tab: "users" })}>{t("seeAll")}</button>}>
            <BarList
              rows={data.topUsers.map((x) => ({
                key: String(x.pk),
                label: <UserCell name={x.name} username={x.username} avatar={x.avatar} sub={x.lastSeen ? f.relative(x.lastSeen, t) : undefined} />,
                meta: `${f.number(x.logins)} · ${f.number(x.appOpens)}`,
                value: x.logins + x.appOpens,
                onClick: () => selectUser(x.pk),
              }))}
            />
          </Card>
        )}
        <Card title={t("engagement")} hint={t("kpiAccountsHint", { active: f.number(u.active), inactive: f.number(u.inactive) })}>
          <BarList
            rows={[
              { key: "1d", label: t("seen1d"), value: u.seen1d, meta: `${pct(u.seen1d)} %` },
              { key: "7d", label: t("seen7d"), value: u.seen7d, meta: `${pct(u.seen7d)} %` },
              { key: "30d", label: t("seen30d"), value: u.seen30d, meta: `${pct(u.seen30d)} %` },
              { key: "never", label: t("neverSeen"), value: u.neverSignedIn, meta: `${pct(u.neverSignedIn)} %` },
            ]}
          />
          <div className="card-foot small muted">
            {t("administrator")}: {f.number(u.superusers)} · {t("uService")}: {f.number(u.serviceAccounts)}
          </div>
        </Card>
        {!noEvents && (
          <Card title={t("security")}>
            <div className="subhead">{t("byUsername")}</div>
            <BarList
              rows={data.failed.byUsername.map((x) => ({
                key: x.key,
                label: <span className={x.known ? "" : "muted"}>{x.key}</span>,
                meta: x.known ? undefined : t("noSuchAccount"),
                value: x.count,
              }))}
            />
            <div className="subhead">{t("byAddress")}</div>
            <BarList
              rows={data.failed.byIp.map((x) => ({
                key: x.key,
                label: <span className="mono">{x.key}</span>,
                meta: x.country ? `${flag(x.country)} ${x.country}` : undefined,
                value: x.count,
              }))}
            />
          </Card>
        )}
        {!noEvents && data.countries.length > 0 && (
          <Card title={t("countries")}>
            <BarList rows={data.countries.map((c) => ({ key: c.key, label: `${flag(c.key)} ${countryName(c.key, f.locale)}`, value: c.count }))} />
          </Card>
        )}
      </div>
      <p className="small faint">{t("updatedAt", { when: f.relative(data.generatedAt, t) })}</p>
    </>
  );
}

function Kpi({ label, value, hint, foot, meter }: { label: string; value: string; hint?: string; foot?: string; meter?: number }) {
  return (
    <div className="kpi">
      <span className="kpi-label">{label}</span>
      <span className="kpi-value">{value}</span>
      {meter !== undefined && (
        <span className="kpi-meter" aria-hidden="true">
          <span style={{ width: `${meter}%` }} />
        </span>
      )}
      {hint && <span className="kpi-hint">{hint}</span>}
      {foot && <span className="kpi-hint">{foot}</span>}
    </div>
  );
}

function Card({ title, hint, action, children }: { title: string; hint?: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="admin-card">
      <header className="admin-card-head">
        <div>
          <h2>{title}</h2>
          {hint && <p className="small muted">{hint}</p>}
        </div>
        {action}
      </header>
      {children}
    </section>
  );
}

function OverviewSkeleton() {
  return (
    <>
      <div className="kpi-grid">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="skeleton" style={{ height: 96 }} />
        ))}
      </div>
      <div className="skeleton" style={{ height: 240 }} />
      <div className="card-grid">
        <div className="skeleton" style={{ height: 260 }} />
        <div className="skeleton" style={{ height: 260 }} />
      </div>
    </>
  );
}

// --- Users ---

type UserFilter = "all" | "active" | "admins" | "nomfa" | "dormant" | "inactive" | "service";
const USER_FILTERS: { id: UserFilter; label: StringKey; test: (u: AdminUserRow) => boolean }[] = [
  { id: "all", label: "uAll", test: (u) => u.kind === "person" },
  { id: "active", label: "uActive", test: (u) => u.kind === "person" && u.isActive },
  { id: "admins", label: "uAdmins", test: (u) => u.kind === "person" && u.isActive && u.isSuperuser },
  { id: "nomfa", label: "uNoMfa", test: (u) => u.kind === "person" && u.isActive && !!u.mfa && u.mfa.totp + u.mfa.webauthn === 0 },
  { id: "dormant", label: "uDormant", test: (u) => u.kind === "person" && u.isActive && (!u.lastSeen || Date.now() - Date.parse(u.lastSeen) > 30 * 86_400_000) },
  { id: "inactive", label: "uInactive", test: (u) => u.kind === "person" && !u.isActive },
  { id: "service", label: "uService", test: (u) => u.kind === "service" },
];

type SortKey = "name" | "lastSeen" | "logins" | "appOpens" | "mfa" | "joined";

const mfaScore = (m: MfaSummary | null) => (m ? m.totp + m.webauthn * 2 : -1);

function UsersTable() {
  const { t, f } = useSettings();
  const { query, setQuery, selectUser } = useApp();
  const { params } = usePeriod();
  const { data, error } = useApi<AdminUsers>(`/admin/users?${params}`);
  const filter = (USER_FILTERS.some((x) => x.id === query.filter) ? query.filter : "all") as UserFilter;
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: "lastSeen", desc: true });
  const q = (query.q ?? "").trim().toLowerCase();

  const counts = useMemo(() => Object.fromEntries(USER_FILTERS.map((x) => [x.id, (data?.users ?? []).filter(x.test).length])), [data]);
  const rows = useMemo(() => {
    const test = USER_FILTERS.find((x) => x.id === filter)!.test;
    const list = (data?.users ?? []).filter((u) => test(u) && (!q || `${u.name} ${u.username} ${u.email} ${u.groups.join(" ")}`.toLowerCase().includes(q)));
    const val = (u: AdminUserRow): string | number =>
      sort.key === "name" ? (u.name || u.username).toLowerCase() : sort.key === "lastSeen" ? (u.lastSeen ?? "") : sort.key === "joined" ? (u.dateJoined ?? "") : sort.key === "mfa" ? mfaScore(u.mfa) : u[sort.key];
    return list.sort((a, b) => {
      const x = val(a);
      const y = val(b);
      const c = typeof x === "number" && typeof y === "number" ? x - y : String(x).localeCompare(String(y));
      return sort.desc ? -c : c;
    });
  }, [data, filter, q, sort]);

  if (!data) return error ? <p className="error-text">{error}</p> : <div className="skeleton" style={{ height: 420 }} />;

  const header = (key: SortKey, label: StringKey, className = "") => {
    const on = sort.key === key;
    return (
      <th className={className} aria-sort={on ? (sort.desc ? "descending" : "ascending") : undefined}>
        <button className="th-sort" onClick={() => setSort({ key, desc: on ? !sort.desc : key !== "name" })}>
          {t(label)}
          {on && (sort.desc ? <ChevronDown size={12} /> : <ChevronUp size={12} />)}
        </button>
      </th>
    );
  };

  return (
    <>
      <Warnings warnings={data.warnings} truncated={data.truncated} />
      <div className="chip-row" role="group" aria-label={t("filters")}>
        {USER_FILTERS.filter((x) => x.id !== "service" || counts.service > 0).map((x) => (
          <button key={x.id} className={`chip${filter === x.id ? " active" : ""}`} aria-pressed={filter === x.id} onClick={() => setQuery({ filter: x.id === "all" ? undefined : x.id }, true)}>
            {t(x.label)}
            <span className="chip-count">{counts[x.id]}</span>
          </button>
        ))}
      </div>
      <div className="table-wrap">
        <table className="admin-table">
          <thead>
            <tr>
              {header("name", "colUser")}
              {header("lastSeen", "colLastSeen")}
              {header("logins", "colSignIns", "num")}
              {header("appOpens", "colAppOpens", "num")}
              {header("mfa", "colMfa")}
              <th className="hide-narrow">{t("colGroups")}</th>
              {header("joined", "colJoined", "hide-narrow")}
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.pk} className={query.user === String(u.pk) ? "selected" : ""} onClick={() => selectUser(query.user === String(u.pk) ? undefined : u.pk)}>
                <td>
                  <button className="row-link" onClick={(e) => (e.stopPropagation(), selectUser(u.pk))}>
                    <UserCell
                      name={u.name}
                      username={u.username}
                      avatar={u.avatar}
                      sub={
                        <>
                          {u.username}
                          {u.isSuperuser && <span className="badge">{t("administrator")}</span>}
                          {!u.isActive && <span className="badge warn">{t("deactivated")}</span>}
                          {u.kind === "service" && <span className="badge">{t("serviceAccount")}</span>}
                        </>
                      }
                    />
                  </button>
                </td>
                <td className="nowrap" title={u.lastSeen ? new Date(u.lastSeen).toLocaleString(f.locale) : undefined}>
                  {u.lastSeen ? f.relative(u.lastSeen, t) : <span className="faint">{t("never")}</span>}
                </td>
                <td className="num">{u.logins ? f.number(u.logins) : <span className="faint">0</span>}</td>
                <td className="num">{u.appOpens ? f.number(u.appOpens) : <span className="faint">0</span>}</td>
                <td>
                  <MfaBadges mfa={u.mfa} />
                </td>
                <td className="hide-narrow groups-cell">{u.groups.join(", ")}</td>
                <td className="hide-narrow nowrap">{u.dateJoined ? f.mediumDate(u.dateJoined) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 && <p className="table-empty">{t("noUsersMatch")}</p>}
      </div>
    </>
  );
}

export function MfaBadges({ mfa }: { mfa: MfaSummary | null }) {
  const { t } = useSettings();
  if (!mfa) return <span className="faint">–</span>;
  if (mfa.totp + mfa.webauthn === 0) return <span className="badge warn">{t("mfaNone")}</span>;
  return (
    <span className="badges">
      {mfa.webauthn > 0 && <span className="badge good">{t("mfaPasskey")}</span>}
      {mfa.totp > 0 && <span className="badge good">{t("mfaApp")}</span>}
    </span>
  );
}

// --- Activity ---

function Activity() {
  const { t, f } = useSettings();
  const { query, setQuery } = useApp();
  const { params } = usePeriod();
  const kind = ["login", "failed", "app"].includes(query.kind) ? query.kind : "";
  const q = (query.q ?? "").trim();
  const { data, error } = useApi<AdminEvents>(`/admin/events?${params}${kind ? `&kind=${kind}` : ""}${q ? `&q=${encodeURIComponent(q)}` : ""}`);
  const options: { id: string; label: StringKey }[] = [
    { id: "", label: "eAll" },
    { id: "login", label: "eSignIns" },
    { id: "app", label: "eApps" },
    { id: "failed", label: "eFailed" },
  ];

  return (
    <>
      {data && <Warnings warnings={data.warnings} truncated={data.truncated} />}
      <div className="chip-row" role="group" aria-label={t("filters")}>
        {options.map((o) => (
          <button key={o.id} className={`chip${kind === o.id ? " active" : ""}`} aria-pressed={kind === o.id} onClick={() => setQuery({ kind: o.id || undefined }, true)}>
            {t(o.label)}
          </button>
        ))}
      </div>
      {!data ? (
        error ? <p className="error-text">{error}</p> : <div className="skeleton" style={{ height: 420 }} />
      ) : data.events.length === 0 ? (
        <p className="table-empty">{t("noEvents")}</p>
      ) : (
        <>
          <div className="event-list">
            {data.events.map((e) => (
              <EventRow key={e.id} e={e} />
            ))}
          </div>
          {data.total > data.events.length && <p className="small faint">{t("showingLatest", { n: f.number(data.events.length), total: f.number(data.total) })}</p>}
        </>
      )}
    </>
  );
}
