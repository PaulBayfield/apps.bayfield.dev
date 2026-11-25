// Pieces shared by the admin pages and panel: the period, data loading, the day chart, small lists.

import { useMemo, useState, type ReactNode } from "react";
import { api, type AccessWarning, type AdminWarning, type DayPoint, type UsageEvent } from "../../lib/api";
import { useApp } from "../../lib/app";
import { invalidate } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import { Avatar } from "../common";
import { ExternalLink, Info, Key, X } from "../icons";

export const PERIODS = [7, 30, 90] as const;

/** The period (?days=) and the viewer's time zone, as query parameters for the admin API. */
export function usePeriod() {
  const { query } = useApp();
  const days = PERIODS.includes(Number(query.days) as 7) ? Number(query.days) : 30;
  const tz = useMemo(() => Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC", []);
  return { days, params: `days=${days}&tz=${encodeURIComponent(tz)}` };
}

/** Asks Authentik again (skipping the server's caches), then reloads what's on screen. */
export async function refreshAdmin(params: string, tab?: string) {
  await api(tab === "access" ? `/admin/access?refresh=1` : `/admin/overview?${params}&refresh=1`);
  invalidate("/admin");
}

export function PeriodPicker() {
  const { t } = useSettings();
  const { setQuery } = useApp();
  const { days } = usePeriod();
  return (
    <div className="segmented" role="group" aria-label={t("period")}>
      {PERIODS.map((n) => (
        <button key={n} className={days === n ? "active" : ""} aria-pressed={days === n} title={t("lastNDays", { n })} onClick={() => setQuery({ days: n === 30 ? undefined : String(n) }, true)}>
          {t("nDaysShort", { n })}
        </button>
      ))}
    </div>
  );
}

const WARNING_TEXT: Record<AdminWarning | AccessWarning, StringKey> = { events: "warnEvents", mfa: "warnMfa", apps: "warnApps", access: "warnAccess", rules: "warnRules" };

export function Warnings({ warnings, truncated }: { warnings: (AdminWarning | AccessWarning)[]; truncated?: boolean }) {
  const { t } = useSettings();
  const list = [...new Set(warnings)].map((w) => t(WARNING_TEXT[w]));
  if (truncated) list.push(t("warnTruncated"));
  if (!list.length) return null;
  return (
    <div className="admin-warnings">
      {list.map((text) => (
        <p key={text} className="admin-warning">
          <Info size={14} />
          <span>{text}</span>
        </p>
      ))}
    </div>
  );
}

/** Rounds up to 1, 2 or 5 × 10ⁿ, so the gridline labels are round numbers. */
function niceMax(v: number) {
  if (v <= 4) return 4;
  const pow = 10 ** Math.floor(Math.log10(v));
  return ([1, 2, 5, 10].find((m) => m * pow >= v) ?? 10) * pow;
}

/** One series of daily values as bars (the title says what it is), with a tooltip per day. */
export function DayBars({ points, value, label, height = 160 }: { points: DayPoint[]; value: (p: DayPoint) => number; label: string; height?: number }) {
  const { f } = useSettings();
  const [hover, setHover] = useState<number | null>(null);
  const max = niceMax(Math.max(0, ...points.map(value)));
  const n = points.length;
  const dayLabel = (d: string) => new Intl.DateTimeFormat(f.locale, { day: "numeric", month: "short" }).format(new Date(`${d}T12:00:00`));
  const weekday = (d: string) => new Intl.DateTimeFormat(f.locale, { weekday: "long", day: "numeric", month: "long" }).format(new Date(`${d}T12:00:00`));
  const ticks = [max, max / 2, 0];
  const p = hover !== null ? points[hover] : null;

  return (
    <div className="chart" role="img" aria-label={label}>
      <div className="chart-plot" style={{ height }} onPointerLeave={() => setHover(null)}>
        {ticks.map((tk) => (
          <div key={tk} className="chart-grid" style={{ bottom: `${(tk / max) * 100}%` }}>
            <span className="chart-tick">{f.number(tk)}</span>
          </div>
        ))}
        <div className="chart-bars" style={{ gap: n > 45 ? 1 : 2 }}>
          {points.map((pt, i) => {
            const v = value(pt);
            return (
              <div key={pt.day} className={`chart-col${hover === i ? " hover" : ""}`} onPointerEnter={() => setHover(i)} onPointerDown={() => setHover(i)}>
                <div className="chart-bar" style={{ height: v ? `max(2px, ${(v / max) * 100}%)` : 0 }} />
              </div>
            );
          })}
        </div>
        {p && hover !== null && (
          <div className={`chart-tip${hover > n * 0.66 ? " left" : hover < n * 0.33 ? " right" : ""}`} style={{ left: `${((hover + 0.5) / n) * 100}%` }}>
            <span className="chart-tip-value">{f.number(value(p))}</span>
            <span className="chart-tip-label">{weekday(p.day)}</span>
          </div>
        )}
      </div>
      <div className="chart-axis">
        {n > 0 && <span>{dayLabel(points[0].day)}</span>}
        {n > 2 && <span>{dayLabel(points[Math.floor((n - 1) / 2)].day)}</span>}
        {n > 1 && <span>{dayLabel(points[n - 1].day)}</span>}
      </div>
    </div>
  );
}

/** A ranked list with a bar per row showing each value against the largest. */
export function BarList({ rows, empty }: { rows: { key: string; label: ReactNode; value: number; meta?: ReactNode; onClick?: () => void }[]; empty?: string }) {
  const { t, f } = useSettings();
  if (!rows.length) return <p className="small faint">{empty ?? t("nothingInPeriod")}</p>;
  const max = Math.max(...rows.map((r) => r.value), 1);
  return (
    <div className="bar-list">
      {rows.map((r) => {
        const inner = (
          <>
            <span className="bar-list-fill" style={{ width: `${(r.value / max) * 100}%` }} />
            <span className="bar-list-label">{r.label}</span>
            {r.meta && <span className="bar-list-meta">{r.meta}</span>}
            <span className="bar-list-value">{f.number(r.value)}</span>
          </>
        );
        return r.onClick ? (
          <button key={r.key} className="bar-list-row clickable" onClick={r.onClick}>
            {inner}
          </button>
        ) : (
          <div key={r.key} className="bar-list-row">
            {inner}
          </div>
        );
      })}
    </div>
  );
}

export function UserCell({ name, username, avatar, sub }: { name: string; username: string; avatar: string | null; sub?: ReactNode }) {
  return (
    <span className="user-cell">
      <Avatar name={name || username} src={avatar} size={26} />
      <span className="user-cell-text">
        <span className="user-cell-name">{name || username}</span>
        <span className="user-cell-sub">{sub ?? username}</span>
      </span>
    </span>
  );
}

/** 🇫🇷-style flag from a two-letter country code (empty when unknown). */
export const flag = (code: string | null) =>
  code && /^[A-Za-z]{2}$/.test(code) ? String.fromCodePoint(...[...code.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65)) : "";

export function countryName(code: string, locale: string) {
  try {
    return new Intl.DisplayNames([locale], { type: "region" }).of(code.toUpperCase()) ?? code;
  } catch {
    return code;
  }
}

/** "Firefox · Windows" from a user agent, roughly. */
export function shortAgent(ua: string | null): string | null {
  if (!ua) return null;
  const browser = /Edg\//.test(ua) ? "Edge" : /Firefox\//.test(ua) ? "Firefox" : /Chrome\//.test(ua) ? "Chrome" : /Safari\//.test(ua) ? "Safari" : null;
  const os = /iPhone|iPad/.test(ua) ? "iOS" : /Android/.test(ua) ? "Android" : /Windows/.test(ua) ? "Windows" : /Mac OS X|Macintosh/.test(ua) ? "macOS" : /Linux/.test(ua) ? "Linux" : null;
  return [browser, os].filter(Boolean).join(" · ") || null;
}

/** One line of the event log. `showUser`: the account it's about (off inside a user's own panel). */
export function EventRow({ e, showUser = true }: { e: UsageEvent; showUser?: boolean }) {
  const { t, f } = useSettings();
  const { selectUser } = useApp();
  const icon = e.kind === "login" ? <Key size={14} /> : e.kind === "failed" ? <X size={14} /> : <ExternalLink size={14} />;
  const place = [e.city, e.country && countryName(e.country, f.locale)].filter(Boolean).join(", ");
  const meta = [place && `${flag(e.country)} ${place}`, e.ip, shortAgent(e.userAgent)].filter(Boolean).join(" · ");
  return (
    <div className={`event-row ${e.kind}`}>
      <span className="event-icon">{icon}</span>
      <span className="event-text">
        <span className="event-title">
          {showUser &&
            (e.pk !== null ? (
              <button className="event-user" onClick={() => selectUser(e.pk!)}>
                {e.username}
              </button>
            ) : (
              <span className="event-user unknown">{e.username || "?"}</span>
            ))}
          <span className="event-what">{e.kind === "login" ? t("evLogin") : e.kind === "failed" ? t("evFailed") : t("evApp", { app: e.app ?? "?" })}</span>
        </span>
        {meta && <span className="event-meta">{meta}</span>}
      </span>
      <time className="event-when" dateTime={e.at} title={new Date(e.at).toLocaleString(f.locale)}>
        {f.relative(e.at, t)}
      </time>
    </div>
  );
}
