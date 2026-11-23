// The side panel on the admin pages: the selected user's account, usage, authenticators, the apps
// they can open, and their latest events.

import type { ReactNode } from "react";
import type { AdminUserDetail, MfaDevice } from "../../lib/api";
import { useApp } from "../../lib/app";
import { useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import { AppIcon } from "../AppIcon";
import { Avatar, CopyButton } from "../common";
import { ExternalLink, Fingerprint, Key, Smartphone, X } from "../icons";
import { DayBars, EventRow, Warnings, usePeriod } from "./shared";

export function AdminPanel() {
  const { t } = useSettings();
  const { query, togglePanel } = useApp();
  const pk = query.user && /^\d+$/.test(query.user) ? Number(query.user) : null;

  return (
    <aside className="panel">
      <div className="panel-header">
        <span className="panel-label">{pk !== null ? t("details") : t("administration")}</span>
        <div className="toolbar-spacer" />
        <button className="icon-button" aria-label={t("close")} title={`${t("close")} (.)`} onClick={togglePanel}>
          <X />
        </button>
      </div>
      <div className="panel-body">
        {pk !== null ? (
          <UserDetails pk={pk} />
        ) : (
          <section className="panel-section">
            <p className="small muted">{t("selectUserHint")}</p>
          </section>
        )}
      </div>
    </aside>
  );
}

function UserDetails({ pk }: { pk: number }) {
  const { t, f } = useSettings();
  const { server } = useApp();
  const { days, params } = usePeriod();
  const { data, error } = useApi<AdminUserDetail>(`/admin/users/${pk}?${params}`);

  if (!data || data.user.pk !== pk) {
    return error ? (
      <section className="panel-section">
        <p className="error-text">{error}</p>
      </section>
    ) : (
      <section className="panel-section">
        <div className="skeleton" style={{ height: 120 }} />
        <div className="skeleton" style={{ height: 200 }} />
      </section>
    );
  }
  const u = data.user;
  const noEvents = data.warnings.includes("events");

  return (
    <>
      <section className="panel-section details-head">
        <Avatar name={u.name || u.username} src={u.avatar} size={56} />
        <h2>{u.name || u.username}</h2>
        <p className="muted">{u.email || u.username}</p>
        <div className="badges center">
          {u.isSuperuser && <span className="badge">{t("administrator")}</span>}
          {!u.isActive && <span className="badge warn">{t("deactivated")}</span>}
          {u.kind === "service" && <span className="badge">{t("serviceAccount")}</span>}
        </div>
        {data.adminUrl && (
          <div className="details-actions">
            <a className="text-button" href={data.adminUrl} target="_blank" rel="noopener noreferrer">
              {t("openInAuthentik", { name: server?.oidc?.name ?? "Authentik" })}
              <ExternalLink size={14} />
            </a>
          </div>
        )}
      </section>

      <Warnings warnings={data.warnings} truncated={data.truncated} />

      {!noEvents && (
        <section className="panel-section">
          <div className="panel-subtitle">
            {t("userActivity")} · {t("lastNDays", { n: days })}
          </div>
          <div className="mini-kpis">
            <MiniKpi label={t("kpiSignIns")} value={f.number(data.totals.logins)} />
            <MiniKpi label={t("kpiAppOpens")} value={f.number(data.totals.appOpens)} />
            <MiniKpi label={t("kpiFailed")} value={f.number(data.totals.failed)} />
          </div>
          <DayBars points={data.series} value={(p) => p.logins + p.appOpens} label={`${t("userActivity")} · ${t("lastNDays", { n: days })}`} height={72} />
        </section>
      )}

      <section className="panel-section">
        <Row label={t("username")}>
          <span className="details-url">
            {u.username}
            <CopyButton text={u.username} />
          </span>
        </Row>
        <Row label={t("colLastSeen")}>{u.lastSeen ? f.relative(u.lastSeen, t) : t("never")}</Row>
        <Row label={t("memberSince")}>{u.dateJoined ? f.mediumDate(u.dateJoined) : t("unknown")}</Row>
        <Row label={t("passwordChanged")}>{u.passwordChangeDate ? f.mediumDate(u.passwordChangeDate) : t("unknown")}</Row>
        <Row label={t("groups")}>{u.groups.length ? u.groups.join(", ") : <span className="faint">{t("noGroups")}</span>}</Row>
      </section>

      {data.devices && (
        <section className="panel-section">
          <div className="panel-subtitle">{t("twoFactor")}</div>
          {data.devices.length === 0 ? <span className="badge warn">{t("twoFactorOff")}</span> : data.devices.map((d) => <DeviceRow key={`${d.kind}:${d.id}`} d={d} />)}
        </section>
      )}

      {data.apps && (
        <section className="panel-section">
          <div className="panel-subtitle">
            {t("accessibleApps")} <span className="faint">{data.apps.length}</span>
          </div>
          <div className="access-list">
            {data.apps.length === 0 && <p className="small faint">{t("noneYet")}</p>}
            {data.apps.map((a) => (
              <div key={a.slug} className="access-item">
                <AppIcon app={{ name: a.name, icon: a.icon }} size={28} />
                <span className="access-text">
                  <span className="access-label">{a.name}</span>
                  {!noEvents && (
                    <span className="small muted">
                      {a.opens ? `${t("nTimes", { n: f.number(a.opens) })} · ${f.relative(a.lastOpened!, t)}` : t("notOpened")}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {!noEvents && (
        <section className="panel-section">
          <div className="panel-subtitle">{t("recentEvents")}</div>
          {data.events.length === 0 ? (
            <p className="small faint">{t("noEvents")}</p>
          ) : (
            <div className="event-list compact">
              {data.events.slice(0, 25).map((e) => (
                <EventRow key={e.id} e={e} showUser={false} />
              ))}
            </div>
          )}
        </section>
      )}
    </>
  );
}

function MiniKpi({ label, value }: { label: string; value: string }) {
  return (
    <div className="mini-kpi">
      <span className="mini-kpi-value">{value}</span>
      <span className="mini-kpi-label">{label}</span>
    </div>
  );
}

function DeviceRow({ d }: { d: MfaDevice }) {
  const { t, f } = useSettings();
  const icon = d.kind === "totp" ? <Smartphone size={14} /> : d.kind === "webauthn" ? <Fingerprint size={14} /> : <Key size={14} />;
  const hint = [d.description ?? d.typeName, d.created && t("addedOn", { date: f.mediumDate(d.created) }), d.lastUsed ? t("lastUsed", { when: f.relative(d.lastUsed, t) }) : null]
    .filter(Boolean)
    .join(" · ");
  return (
    <div className="access-item">
      <span className="access-icon">{icon}</span>
      <span className="access-text">
        <span className="access-label">{d.name}</span>
        <span className="small muted">{hint}</span>
      </span>
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="detail-row">
      <span className="detail-label">{label}</span>
      <span className="detail-value">{children}</span>
    </div>
  );
}
