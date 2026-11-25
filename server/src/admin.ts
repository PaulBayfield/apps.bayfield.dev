// The admin pages, for Authentik superusers and members of ADMIN_GROUPS: accounts, sign-ins and app usage.
//
// No database here either: everything comes from Authentik. Accounts from /core/users/, usage from
// its event log (login, login_failed, authorize_application: an app opened through Authentik), and
// two-factor coverage from each user's authenticators. Read-only: changes are made in Authentik.

import { Hono, type Context, type Next } from "hono";
import { authentik } from "./config.ts";
import { type AppEnv } from "./auth.ts";
import { allGroups, appsFor, bindingsOf, call, canAdmin, devicesFor, groupReach, iconUrl, toUser, type AkDevice, type AkUser, type RawBinding, type RawUser } from "./authentik.ts";
import { HttpError, isTimeZone, rateLimit } from "./http.ts";

const CACHE_MS = 2 * 60_000;
/** At most this many events of each kind are read per range (Authentik pages of 500). */
const MAX_EVENTS = 10_000;
const DAY = 24 * 60 * 60_000;

// --- Accounts ---

export interface AdminUser extends AkUser {
  /** People are "internal" or "external"; service accounts (and outposts) are counted apart. */
  kind: "person" | "service";
}

let usersCache: { users: AdminUser[]; until: number } | null = null;

async function allUsers(fresh = false): Promise<AdminUser[]> {
  if (!fresh && usersCache && usersCache.until > Date.now()) return usersCache.users;
  let users: AdminUser[];
  if (!authentik) users = devData().users;
  else {
    users = [];
    for (let page = 1; page && page <= 100; ) {
      const q = new URLSearchParams({ page_size: "200", page: String(page), ordering: "username" });
      const res = await call<{ pagination: { next: number }; results: RawUser[] }>(`/core/users/?${q}`);
      for (const u of res.results) {
        // Django's placeholder for signed-out visitors.
        if (u.username === "AnonymousUser") continue;
        users.push({ ...toUser(u), kind: u.type?.includes("service_account") ? "service" : "person" });
      }
      page = res.pagination?.next ?? 0;
    }
  }
  usersCache = { users, until: Date.now() + CACHE_MS };
  return users;
}

// --- Two-factor coverage ---

interface MfaSummary {
  totp: number;
  webauthn: number;
  other: number;
}

const mfaCache = new Map<number, { mfa: MfaSummary; until: number }>();

const summarize = (devices: AkDevice[]): MfaSummary => ({
  totp: devices.filter((d) => d.kind === "totp").length,
  webauthn: devices.filter((d) => d.kind === "webauthn").length,
  other: devices.filter((d) => d.kind === "other").length,
});

/** Each active person's authenticators, a few requests at a time (cached 5 minutes). Null if unreadable. */
async function mfaFor(users: AdminUser[]): Promise<Map<number, MfaSummary> | null> {
  const out = new Map<number, MfaSummary>();
  const todo = users.filter((u) => {
    const hit = mfaCache.get(u.pk);
    if (hit && hit.until > Date.now()) out.set(u.pk, hit.mfa);
    return !out.has(u.pk);
  });
  let failed = false;
  const worker = async () => {
    for (let u = todo.shift(); u && !failed; u = todo.shift()) {
      try {
        const mfa = authentik ? summarize(await devicesFor(u.pk)) : devData().mfa.get(u.pk)!;
        mfaCache.set(u.pk, { mfa, until: Date.now() + 5 * 60_000 });
        out.set(u.pk, mfa);
      } catch (e) {
        console.warn("Admin: couldn't read authenticators:", e);
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  return failed ? null : out;
}

const hasMfa = (m: MfaSummary | undefined) => !!m && m.totp + m.webauthn > 0;

// --- Events ---

export type EventKind = "login" | "failed" | "app";

export interface UsageEvent {
  id: string;
  kind: EventKind;
  at: string;
  /** The account, when known (a failed sign-in usually has none). */
  pk: number | null;
  /** The account's username, or the one typed in for a failed sign-in. */
  username: string;
  /** authorize_application: the app opened. */
  app: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  userAgent: string | null;
}

interface RawEvent {
  pk: string;
  action: string;
  created: string;
  client_ip?: string | null;
  user?: { pk?: number; username?: string; is_anonymous?: boolean } | null;
  context?: {
    username?: string;
    authorized_application?: { name?: string } | null;
    geo?: { country?: string; city?: string } | null;
    http_request?: { user_agent?: string } | null;
  } | null;
}

const kindOfAction = (a: string): EventKind | null => (a === "login" ? "login" : a === "login_failed" ? "failed" : a === "authorize_application" ? "app" : null);

function toEvent(e: RawEvent): UsageEvent | null {
  const kind = kindOfAction(e.action);
  if (!kind) return null;
  const known = e.user && !e.user.is_anonymous && typeof e.user.pk === "number" && e.user.username !== "AnonymousUser";
  return {
    id: String(e.pk),
    kind,
    at: e.created,
    pk: known ? e.user!.pk! : null,
    username: (known ? e.user!.username : e.context?.username) ?? "",
    app: e.context?.authorized_application?.name ?? null,
    ip: e.client_ip ?? null,
    country: e.context?.geo?.country ?? null,
    city: e.context?.geo?.city ?? null,
    userAgent: e.context?.http_request?.user_agent ?? null,
  };
}

const eventCache = new Map<string, { events: UsageEvent[]; truncated: boolean; until: number }>();

/**
 * The sign-ins, failed sign-ins and app openings of the last `days` days, newest first.
 * Authentik's `action` filter matches substrings ("login" also finds "login_failed"), so the kind is
 * checked on each event too.
 */
async function eventsSince(days: number, fresh = false): Promise<{ events: UsageEvent[]; truncated: boolean }> {
  const key = String(days);
  const hit = eventCache.get(key);
  if (!fresh && hit && hit.until > Date.now()) return hit;
  const since = Date.now() - days * DAY;
  let truncated = false;
  let events: UsageEvent[];
  if (!authentik) events = devData().events.filter((e) => Date.parse(e.at) >= since);
  else {
    const read = async (action: string) => {
      const out: UsageEvent[] = [];
      for (let page = 1; page; ) {
        const q = new URLSearchParams({ action, ordering: "-created", page_size: "500", page: String(page) });
        const res = await call<{ pagination: { next: number }; results: RawEvent[] }>(`/events/events/?${q}`);
        let done = false;
        for (const raw of res.results) {
          if (Date.parse(raw.created) < since) {
            done = true;
            break;
          }
          const e = toEvent(raw);
          if (e) out.push(e);
        }
        if (out.length >= MAX_EVENTS) truncated = true;
        page = done || truncated ? 0 : (res.pagination?.next ?? 0);
      }
      return out;
    };
    const [logins, apps] = await Promise.all([read("login"), read("authorize_application")]);
    const seen = new Set<string>();
    events = [...logins, ...apps].filter((e) => !seen.has(e.id) && !!seen.add(e.id)).sort((a, b) => b.at.localeCompare(a.at));
  }
  const entry = { events, truncated, until: Date.now() + CACHE_MS };
  eventCache.set(key, entry);
  return entry;
}

// --- Stats ---

const dayKey = (tz: string) => {
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" });
  return (t: string | number | Date) => fmt.format(new Date(t));
};

/** Every day of the range, oldest first, in the viewer's time zone. */
function daysOf(days: number, tz: string): string[] {
  const key = dayKey(tz);
  const out: string[] = [];
  for (let i = days - 1; i >= 0; i--) {
    const k = key(Date.now() - i * DAY);
    if (out.at(-1) !== k) out.push(k);
  }
  return out;
}

interface DayPoint {
  day: string;
  logins: number;
  failed: number;
  appOpens: number;
  /** Distinct accounts that signed in or opened an app. */
  users: number;
}

function series(events: UsageEvent[], days: number, tz: string): DayPoint[] {
  const key = dayKey(tz);
  const points = new Map(daysOf(days, tz).map((d) => [d, { day: d, logins: 0, failed: 0, appOpens: 0, users: new Set<number>() }]));
  for (const e of events) {
    const p = points.get(key(e.at));
    if (!p) continue;
    if (e.kind === "login") p.logins++;
    else if (e.kind === "failed") p.failed++;
    else p.appOpens++;
    if (e.pk !== null && e.kind !== "failed") p.users.add(e.pk);
  }
  return [...points.values()].map((p) => ({ ...p, users: p.users.size }));
}

const top = <T>(m: Map<string, T & { count: number }>, n: number) => [...m.values()].sort((a, b) => b.count - a.count).slice(0, n);

/** Per account: sign-ins and app openings in the range, and the latest of either. */
function perUser(events: UsageEvent[]) {
  const out = new Map<number, { logins: number; appOpens: number; failed: number; lastSeen: string | null }>();
  for (const e of events) {
    if (e.pk === null) continue;
    const s = out.get(e.pk) ?? { logins: 0, appOpens: 0, failed: 0, lastSeen: null };
    if (e.kind === "login") s.logins++;
    else if (e.kind === "app") s.appOpens++;
    else s.failed++;
    if (e.kind !== "failed" && (!s.lastSeen || e.at > s.lastSeen)) s.lastSeen = e.at;
    out.set(e.pk, s);
  }
  return out;
}

/** When the account was last seen: Authentik's last login or the latest event, whichever is newer. */
const lastSeenOf = (u: AkUser, s?: { lastSeen: string | null }) => [u.lastLogin, s?.lastSeen].filter((x): x is string => !!x).sort().at(-1) ?? null;

async function loadEvents(days: number, fresh: boolean, warnings: string[]) {
  try {
    return await eventsSince(days, fresh);
  } catch (e) {
    console.warn("Admin: couldn't read events:", e);
    warnings.push("events");
    return { events: [] as UsageEvent[], truncated: false };
  }
}

async function overview(days: number, tz: string, fresh: boolean) {
  const warnings: string[] = [];
  const [users, { events, truncated }] = await Promise.all([allUsers(fresh), loadEvents(days, fresh, warnings)]);
  const people = users.filter((u) => u.kind === "person");
  const active = people.filter((u) => u.isActive);
  const mfa = await mfaFor(active);
  if (!mfa) warnings.push("mfa");
  const stats = perUser(events);
  const now = Date.now();
  const seenWithin = (ms: number) => active.filter((u) => {
    const seen = lastSeenOf(u, stats.get(u.pk));
    return !!seen && now - Date.parse(seen) <= ms;
  }).length;

  const byPk = new Map(users.map((u) => [u.pk, u]));
  const apps = new Map<string, { name: string; count: number; users: Set<number> }>();
  const failedNames = new Map<string, { key: string; count: number; known: boolean }>();
  const failedIps = new Map<string, { key: string; country: string | null; count: number }>();
  const countries = new Map<string, { key: string; count: number }>();
  for (const e of events) {
    if (e.kind === "app" && e.app) {
      const a = apps.get(e.app) ?? { name: e.app, count: 0, users: new Set<number>() };
      a.count++;
      if (e.pk !== null) a.users.add(e.pk);
      apps.set(e.app, a);
    }
    if (e.kind === "failed") {
      const name = e.username || "?";
      const n = failedNames.get(name) ?? { key: name, count: 0, known: users.some((u) => u.username === name || (!!u.email && u.email === name)) };
      n.count++;
      failedNames.set(name, n);
      if (e.ip) {
        const ip = failedIps.get(e.ip) ?? { key: e.ip, country: e.country, count: 0 };
        ip.count++;
        failedIps.set(e.ip, ip);
      }
    }
    if (e.kind === "login" && e.country) {
      const c = countries.get(e.country) ?? { key: e.country, count: 0 };
      c.count++;
      countries.set(e.country, c);
    }
  }
  const icons = await appIcons();

  return {
    days,
    tz,
    generatedAt: new Date().toISOString(),
    warnings,
    truncated,
    users: {
      total: people.length,
      active: active.length,
      inactive: people.length - active.length,
      superusers: active.filter((u) => u.isSuperuser).length,
      serviceAccounts: users.length - people.length,
      withMfa: mfa ? active.filter((u) => hasMfa(mfa.get(u.pk))).length : null,
      neverSignedIn: active.filter((u) => !lastSeenOf(u, stats.get(u.pk))).length,
      seen1d: seenWithin(DAY),
      seen7d: seenWithin(7 * DAY),
      seen30d: seenWithin(30 * DAY),
      joinedInRange: people.filter((u) => u.dateJoined && now - Date.parse(u.dateJoined) <= days * DAY).length,
    },
    totals: {
      logins: events.filter((e) => e.kind === "login").length,
      failed: events.filter((e) => e.kind === "failed").length,
      appOpens: events.filter((e) => e.kind === "app").length,
      activeUsers: [...stats.entries()].filter(([pk, s]) => byPk.get(pk)?.kind !== "service" && s.logins + s.appOpens > 0).length,
    },
    series: series(events, days, tz),
    apps: top(apps, 10).map((a) => ({ name: a.name, icon: icons.get(a.name) ?? null, opens: a.count, users: a.users.size })),
    topUsers: [...stats.entries()]
      .map(([pk, s]) => ({ u: byPk.get(pk), s }))
      .filter((x): x is { u: AdminUser; s: typeof x.s } => !!x.u && x.u.kind === "person" && x.s.logins + x.s.appOpens > 0)
      .sort((a, b) => b.s.logins + b.s.appOpens - (a.s.logins + a.s.appOpens))
      .slice(0, 8)
      .map(({ u, s }) => ({ pk: u.pk, username: u.username, name: u.name, avatar: u.avatar, logins: s.logins, appOpens: s.appOpens, lastSeen: lastSeenOf(u, s) })),
    failed: { byUsername: top(failedNames, 6), byIp: top(failedIps, 6) },
    countries: top(countries, 8),
  };
}

async function userRows(days: number, fresh: boolean) {
  const warnings: string[] = [];
  const [users, { events, truncated }] = await Promise.all([allUsers(fresh), loadEvents(days, fresh, warnings)]);
  const mfa = await mfaFor(users.filter((u) => u.isActive && u.kind === "person"));
  if (!mfa) warnings.push("mfa");
  const stats = perUser(events);
  return {
    days,
    warnings,
    truncated,
    users: users.map((u) => {
      const s = stats.get(u.pk);
      return {
        pk: u.pk,
        username: u.username,
        name: u.name,
        email: u.email,
        avatar: u.avatar,
        isActive: u.isActive,
        isSuperuser: u.isSuperuser,
        kind: u.kind,
        groups: u.groups,
        dateJoined: u.dateJoined,
        passwordChangeDate: u.passwordChangeDate,
        lastSeen: lastSeenOf(u, s),
        logins: s?.logins ?? 0,
        appOpens: s?.appOpens ?? 0,
        failed: s?.failed ?? 0,
        /** Null: unknown (inactive, service account, or authenticators unreadable). */
        mfa: mfa?.get(u.pk) ?? null,
      };
    }),
  };
}

async function userDetail(pk: number, days: number, tz: string, fresh: boolean) {
  const warnings: string[] = [];
  const users = await allUsers(fresh);
  const user = users.find((u) => u.pk === pk);
  if (!user) throw new HttpError(404, "Not found");
  const [{ events, truncated }, devices, apps] = await Promise.all([
    loadEvents(days, fresh, warnings),
    (authentik ? devicesFor(pk) : Promise.resolve(devData().devices(pk))).catch(() => {
      warnings.push("mfa");
      return null;
    }),
    appsFor(pk, fresh).catch(() => {
      warnings.push("apps");
      return null;
    }),
  ]);
  // A failed sign-in has no account, only the username typed in.
  const mine = events.filter((e) => e.pk === pk || (e.kind === "failed" && e.pk === null && (e.username === user.username || (!!user.email && e.username === user.email))));
  const s = perUser(mine.map((e) => ({ ...e, pk })));
  const opened = new Map<string, { name: string; count: number; last: string }>();
  for (const e of mine) {
    if (e.kind !== "app" || !e.app) continue;
    const a = opened.get(e.app) ?? { name: e.app, count: 0, last: e.at };
    a.count++;
    opened.set(e.app, a);
  }
  return {
    days,
    warnings,
    truncated,
    user: { ...user, lastSeen: lastSeenOf(user, s.get(pk)) },
    totals: { logins: s.get(pk)?.logins ?? 0, appOpens: s.get(pk)?.appOpens ?? 0, failed: s.get(pk)?.failed ?? 0 },
    series: series(mine, days, tz),
    devices,
    apps: apps?.map((a) => ({ slug: a.slug, name: a.name, icon: a.icon, url: a.url, opens: opened.get(a.name)?.count ?? 0, lastOpened: opened.get(a.name)?.last ?? null })) ?? null,
    events: mine.slice(0, 100),
    adminUrl: authentik ? `${authentik.url}/if/admin/#/identity/users/${pk}` : null,
  };
}

/** Application icons by name, for the usage lists (events only carry the name). */
let iconCache: { icons: Map<string, string>; until: number } | null = null;
async function appIcons(): Promise<Map<string, string>> {
  if (iconCache && iconCache.until > Date.now()) return iconCache.icons;
  const icons = new Map<string, string>();
  if (authentik) {
    try {
      const res = await call<{ results: { name: string; meta_icon?: string | null; meta_icon_url?: string | null }[] }>(
        `/core/applications/?${new URLSearchParams({ superuser_full_list: "true", page_size: "500" })}`,
      );
      for (const a of res.results) {
        const icon = a.meta_icon_url ?? a.meta_icon;
        if (typeof icon !== "string" || icon.startsWith("fa://")) continue;
        if (/^https?:\/\//.test(icon)) icons.set(a.name, icon);
        else if (icon.startsWith("/")) icons.set(a.name, `${authentik.url}${icon}`);
      }
    } catch {
      /* Icons are a nicety. */
    }
  }
  iconCache = { icons, until: Date.now() + 10 * 60_000 };
  return icons;
}

// --- Who can open each app ---
//
// For every active person, Authentik's own policy check (the `for_user` filter, the same one the
// launcher uses) says which applications they may open; turned around, that's the list of people
// per app. The bindings then say why: the bound groups (directly or through a child group), a
// binding naming the user, or a policy whose verdict only Authentik knows.

export type AccessWarning = "access" | "rules";

export interface AccessGrant {
  pk: number;
  /** The bound groups that let them in; `via`: their own group, when the bound one is its ancestor. */
  groups: { name: string; via: string | null }[];
  /** A binding names this user. */
  direct: boolean;
}

export interface AccessApp {
  slug: string;
  name: string;
  icon: string | null;
  url: string | null;
  category: string;
  /** "any" (one binding is enough) or "all" (each must pass). */
  mode: "any" | "all";
  /** The app's bindings, or null when they couldn't be read. */
  rules: { everyone: boolean; groups: string[]; users: number[]; policies: string[] } | null;
  /** Who can open it, or null when that couldn't be worked out. */
  users: AccessGrant[] | null;
}

interface RawAppFull {
  pk: string;
  slug: string;
  name: string;
  launch_url?: string | null;
  meta_launch_url?: string;
  meta_icon?: string | null;
  meta_icon_url?: string | null;
  group?: string;
  policy_engine_mode?: string;
}

let accessCache: { data: Awaited<ReturnType<typeof computeAccess>>; until: number } | null = null;
const slugCache = new Map<number, { slugs: Set<string>; until: number }>();

/** Every application in Authentik (with or without a launch URL). */
async function everyApp(): Promise<RawAppFull[]> {
  const out: RawAppFull[] = [];
  for (let page = 1; page && page <= 50; ) {
    const q = new URLSearchParams({ superuser_full_list: "true", ordering: "name", page_size: "200", page: String(page) });
    const res = await call<{ pagination: { next: number }; results: RawAppFull[] }>(`/core/applications/?${q}`);
    out.push(...res.results);
    page = res.pagination?.next ?? 0;
  }
  return out;
}

/** The slugs of every application `pk` may open, as Authentik's policy engine decides. */
async function slugsFor(pk: number, fresh: boolean): Promise<Set<string>> {
  const hit = slugCache.get(pk);
  if (!fresh && hit && hit.until > Date.now()) return hit.slugs;
  const slugs = new Set<string>();
  // Filtered by policy after paginating, so pages can come back short: follow `next`.
  for (let page = 1; page && page <= 50; ) {
    const q = new URLSearchParams({ for_user: String(pk), page_size: "200", page: String(page) });
    const res = await call<{ pagination: { next: number }; results: { slug: string }[] }>(`/core/applications/?${q}`);
    for (const a of res.results) slugs.add(a.slug);
    page = res.pagination?.next ?? 0;
  }
  slugCache.set(pk, { slugs, until: Date.now() + CACHE_MS });
  return slugs;
}

async function computeAccess(fresh: boolean) {
  const warnings: AccessWarning[] = [];
  const users = await allUsers(fresh);
  const people = users.filter((u) => u.kind === "person" && u.isActive);
  if (!authentik) return devAccess(people);

  const [rawApps, groups] = await Promise.all([everyApp(), allGroups().catch(() => null)]);

  // Each person's apps, six at a time.
  const access = new Map<number, Set<string>>();
  let failed = false;
  const todo = [...people];
  const worker = async () => {
    for (let u = todo.shift(); u && !failed; u = todo.shift()) {
      try {
        access.set(u.pk, await slugsFor(u.pk, fresh));
      } catch (e) {
        console.warn("Admin: couldn't read a user's apps:", e);
        failed = true;
      }
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  if (failed) warnings.push("access");

  const bindings = new Map<string, RawBinding[]>();
  if (groups) {
    try {
      await Promise.all(rawApps.map(async (a) => bindings.set(a.slug, (await bindingsOf(String(a.pk))).filter((b) => b.enabled !== false))));
    } catch (e) {
      console.warn("Admin: couldn't read policy bindings:", e);
      bindings.clear();
    }
  }
  if (!groups || bindings.size < rawApps.length) warnings.push("rules");
  const reach = new Map(people.map((u) => [u.pk, groups ? groupReach(u.groupIds, groups) : new Map<string, string | null>()]));

  const apps: AccessApp[] = rawApps.map((a) => {
    const url = a.launch_url || a.meta_launch_url || "";
    const bound = bindings.get(a.slug);
    const allowing = bound?.filter((b) => !b.negate) ?? [];
    const groupName = (pk: string) => groups?.get(pk)?.name ?? "?";
    return {
      slug: a.slug,
      name: a.name,
      icon: iconUrl(a.meta_icon_url ?? a.meta_icon),
      url: /^https?:\/\//.test(url) ? url : null,
      category: a.group ?? "",
      mode: a.policy_engine_mode === "all" ? "all" : "any",
      rules: bound
        ? {
            everyone: bound.length === 0,
            groups: [...new Set(allowing.filter((b) => b.group).map((b) => groupName(String(b.group))))].sort((x, y) => x.localeCompare(y)),
            users: [...new Set(allowing.filter((b) => typeof b.user === "number").map((b) => b.user!))],
            policies: [...new Set(allowing.filter((b) => b.policy).map((b) => b.policy_obj?.name ?? "?"))],
          }
        : null,
      users: failed
        ? null
        : people
            .filter((u) => access.get(u.pk)?.has(a.slug))
            .map((u) => {
              const r = reach.get(u.pk)!;
              const seen = new Set<string>();
              const via: AccessGrant["groups"] = [];
              for (const b of allowing) {
                const g = b.group ? String(b.group) : null;
                if (!g || !r.has(g) || seen.has(g)) continue;
                seen.add(g);
                via.push({ name: groupName(g), via: r.get(g) ?? null });
              }
              return { pk: u.pk, groups: via, direct: allowing.some((b) => b.user === u.pk) };
            }),
    };
  });
  return { warnings, apps, users: people };
}

async function accessOverview(fresh: boolean) {
  if (fresh || !accessCache || accessCache.until <= Date.now()) accessCache = { data: await computeAccess(fresh), until: Date.now() + CACHE_MS };
  const { warnings, apps, users } = accessCache.data;
  return {
    generatedAt: new Date(accessCache.until - CACHE_MS).toISOString(),
    warnings,
    apps,
    /** The active people, for the names and avatars behind the pks above. */
    users: users.map((u) => ({ pk: u.pk, username: u.username, name: u.name, email: u.email, avatar: u.avatar, isSuperuser: u.isSuperuser, groups: u.groups })),
    adminUrl: authentik ? `${authentik.url}/if/admin/#/core/applications` : null,
  };
}

// --- Routes ---

async function requireAdmin(c: Context<AppEnv>, next: Next) {
  const user = c.get("user");
  if (!user) throw new HttpError(401, "Not signed in");
  if (!(await canAdmin(user))) throw new HttpError(403, "Only administrators can see this");
  await next();
}

/** ?days=7|30|90 (default 30), ?tz= the viewer's time zone (for the days), ?refresh=1 skips the caches. */
function params(c: Context) {
  const days = [7, 30, 90].includes(Number(c.req.query("days"))) ? Number(c.req.query("days")) : 30;
  const tz = c.req.query("tz");
  const fresh = c.req.query("refresh") === "1";
  if (fresh) rateLimit(c, "admin-refresh", 20, 60_000);
  return { days, tz: isTimeZone(tz) ? tz : "UTC", fresh };
}

export const admin = new Hono<AppEnv>();
admin.use("*", requireAdmin);

admin.get("/overview", async (c) => {
  const { days, tz, fresh } = params(c);
  return c.json(await overview(days, tz, fresh));
});

admin.get("/users", async (c) => {
  const { days, fresh } = params(c);
  return c.json(await userRows(days, fresh));
});

admin.get("/users/:pk", async (c) => {
  const pk = Number(c.req.param("pk"));
  if (!Number.isInteger(pk)) throw new HttpError(404, "Not found");
  const { days, tz, fresh } = params(c);
  return c.json(await userDetail(pk, days, tz, fresh));
});

/** Every application and the active people who can open it (with what lets them in). ?refresh=1 skips the caches. */
admin.get("/access", async (c) => {
  const { fresh } = params(c);
  return c.json(await accessOverview(fresh));
});

/** The latest events, newest first: ?kind=login|failed|app, ?q= matches the user, app, IP or place. */
admin.get("/events", async (c) => {
  const { days, fresh } = params(c);
  const warnings: string[] = [];
  const { events, truncated } = await loadEvents(days, fresh, warnings);
  const kind = kindOfAction({ login: "login", failed: "login_failed", app: "authorize_application" }[c.req.query("kind") ?? ""] ?? "");
  const q = (c.req.query("q") ?? "").trim().toLowerCase();
  const matching = events.filter(
    (e) => (!kind || e.kind === kind) && (!q || `${e.username} ${e.app ?? ""} ${e.ip ?? ""} ${e.city ?? ""} ${e.country ?? ""}`.toLowerCase().includes(q)),
  );
  return c.json({ days, warnings, truncated, total: matching.length, events: matching.slice(0, 300) });
});

// --- Local development stand-in (DEV_LOGIN_USER): a made-up organisation ---

/** Who can open what in the made-up organisation, from the groups devData() gives people. */
function devAccess(people: AdminUser[]) {
  const apps: { slug: string; name: string; url: string | null; category: string; groups: string[]; users?: number[]; policies?: string[]; mode?: "any" | "all" }[] = [
    { slug: "notes", name: "Notes", url: "https://notes.bayfield.dev", category: "Productivity", groups: ["Family", "Developers"] },
    { slug: "calendar", name: "Calendar", url: "https://calendar.bayfield.dev", category: "Productivity", groups: ["Family"], users: [9] },
    { slug: "devtime", name: "DevTime", url: "https://dev.bayfield.dev", category: "Development", groups: ["Developers"], users: [2] },
    { slug: "music", name: "Music", url: "https://music.bayfield.dev", category: "Media", groups: [] },
    { slug: "internal", name: "Internal", url: "https://internal.bayfield.dev", category: "Administration", groups: ["Admins"], policies: ["Office network only"], mode: "all" },
    { slug: "apps-proxy", name: "Proxy outpost", url: null, category: "", groups: ["Admins"] },
  ];
  return {
    warnings: [] as AccessWarning[],
    users: people,
    apps: apps.map((a): AccessApp => {
      const everyone = !a.groups.length && !a.users?.length && !a.policies?.length;
      return {
        slug: a.slug,
        name: a.name,
        icon: null,
        url: a.url,
        category: a.category,
        mode: a.mode ?? "any",
        rules: { everyone, groups: a.groups, users: a.users ?? [], policies: a.policies ?? [] },
        users: people
          .map((u) => ({ pk: u.pk, groups: u.groups.filter((g) => a.groups.includes(g)).map((name) => ({ name, via: null })), direct: !!a.users?.includes(u.pk) }))
          .filter((g) => everyone || g.groups.length > 0 || g.direct),
      };
    }),
  };
}

let dev: { users: AdminUser[]; events: UsageEvent[]; mfa: Map<number, MfaSummary>; devices: (pk: number) => AkDevice[] } | null = null;

function devData() {
  if (dev) return dev;
  let seed = 42;
  const rand = () => ((seed = (seed * 16807) % 2147483647) - 1) / 2147483646;
  const pick = <T>(xs: T[]) => xs[Math.floor(rand() * xs.length)];
  const names = [
    ["demo", "Demo User"], ["alice", "Alice Martin"], ["bob", "Bob Dupont"], ["chloe", "Chloé Bernard"], ["david", "David Moreau"],
    ["emma", "Emma Laurent"], ["felix", "Félix Garnier"], ["grace", "Grace Thomas"], ["hugo", "Hugo Petit"], ["ines", "Inès Roux"],
    ["jules", "Jules Fournier"], ["kim", "Kim Lefèvre"], ["leo", "Léo Girard"], ["mia", "Mia Bonnet"],
  ];
  const now = Date.now();
  const users: AdminUser[] = names.map(([username, name], i) => ({
    pk: i + 1,
    username,
    name,
    email: `${username}@example.com`,
    isActive: i !== 11,
    isSuperuser: i < 2,
    avatar: null,
    groups: i < 2 ? ["Admins", "Family"] : i < 7 ? ["Family"] : ["Developers"],
    groupIds: [],
    lastLogin: null,
    dateJoined: new Date(now - (400 - i * 25) * DAY).toISOString(),
    passwordChangeDate: new Date(now - (90 + i * 9) * DAY).toISOString(),
    kind: "person",
  }));
  users.push({ ...users[0], pk: 99, username: "ak-outpost-proxy", name: "Outpost", email: "", isSuperuser: false, groups: [], kind: "service", lastLogin: null });

  const apps = ["Notes", "Calendar", "DevTime", "Music", "Internal"];
  const places: [string, string, string][] = [["FR", "Paris", "82.64.12.7"], ["FR", "Lyon", "90.12.44.3"], ["GB", "London", "81.2.69.160"], ["DE", "Berlin", "85.214.1.9"]];
  const events: UsageEvent[] = [];
  let id = 0;
  for (const u of users.filter((x) => x.kind === "person" && x.isActive && x.pk !== 13)) {
    const busy = 0.15 + rand() * 0.75;
    const [country, city, ip] = pick(places);
    for (let d = 0; d < 90; d++) {
      const weekend = new Date(now - d * DAY).getDay() % 6 === 0;
      if (rand() > busy * (weekend ? 0.5 : 1)) continue;
      const base = now - d * DAY - Math.floor(rand() * 12 * 3600_000);
      const at = (t: number) => new Date(Math.min(now, t)).toISOString();
      const ua = pick(["Mozilla/5.0 (Windows NT 10.0) Firefox/146.0", "Mozilla/5.0 (iPhone; CPU iPhone OS 19_1) Safari/605.1", "Mozilla/5.0 (Macintosh) Chrome/142.0"]);
      events.push({ id: String(++id), kind: "login", at: at(base), pk: u.pk, username: u.username, app: null, ip, country, city, userAgent: ua });
      for (let n = Math.floor(rand() * 4); n > 0; n--) {
        events.push({ id: String(++id), kind: "app", at: at(base + n * 600_000), pk: u.pk, username: u.username, app: pick(u.groups.includes("Developers") ? ["DevTime", "Notes", "DevTime"] : apps), ip, country, city, userAgent: ua });
      }
    }
  }
  for (let n = 0; n < 60; n++) {
    const u = pick(users.slice(0, 13));
    events.push({ id: String(++id), kind: "failed", at: new Date(now - rand() * 90 * DAY).toISOString(), pk: null, username: rand() < 0.3 ? pick(["admin", "root", "test"]) : u.username, app: null, ip: rand() < 0.4 ? "185.220.101.4" : pick(places)[2], country: rand() < 0.4 ? "NL" : "FR", city: null, userAgent: null });
  }
  events.sort((a, b) => b.at.localeCompare(a.at));
  for (const u of users) u.lastLogin = events.find((e) => e.pk === u.pk && e.kind === "login")?.at ?? null;

  const mfa = new Map(users.map((u) => [u.pk, { totp: u.pk % 3 === 0 ? 0 : 1, webauthn: u.pk % 4 === 0 ? 2 : 0, other: u.pk % 5 === 0 ? 1 : 0 }]));
  const devices = (pk: number): AkDevice[] => {
    const m = mfa.get(pk) ?? { totp: 0, webauthn: 0, other: 0 };
    const at = new Date(now - 120 * DAY).toISOString();
    return [
      ...Array.from({ length: m.totp }, (_, i) => ({ id: `t${i}`, kind: "totp" as const, name: "Phone", typeName: "TOTP Device", description: null, created: at, lastUsed: new Date(now - 2 * DAY).toISOString() })),
      ...Array.from({ length: m.webauthn }, (_, i) => ({ id: `w${i}`, kind: "webauthn" as const, name: i ? "YubiKey" : "MacBook", typeName: "WebAuthn Device", description: i ? "YubiKey 5" : "iCloud Keychain", created: at, lastUsed: null })),
      ...Array.from({ length: m.other }, (_, i) => ({ id: `s${i}`, kind: "other" as const, name: "Recovery codes", typeName: "Static Device", description: null, created: at, lastUsed: null })),
    ];
  };
  dev = { users, events, mfa, devices };
  return dev;
}
