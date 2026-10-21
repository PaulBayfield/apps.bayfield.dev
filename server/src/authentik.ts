// The Authentik API, with the service account token (AUTHENTIK_TOKEN):
// - which applications a user may open (the same policy check as Authentik's own library page),
// - the user's profile (read-only here: an admin changes it in Authentik),
// - setting a new password.
//
// Without Authentik (DEV_LOGIN_USER), a small in-memory stand-in answers instead.

import { DEV_LOGIN_USER, authentik } from "./config.ts";
import { HttpError } from "./http.ts";

export interface AkUser {
  pk: number;
  username: string;
  name: string;
  email: string;
  isActive: boolean;
  isSuperuser: boolean;
  avatar: string | null;
  groups: string[];
  lastLogin: string | null;
  dateJoined: string | null;
  passwordChangeDate: string | null;
}

export interface AkApp {
  id: string;
  slug: string;
  name: string;
  url: string;
  description: string;
  publisher: string;
  icon: string | null;
  group: string;
  newTab: boolean;
}

const CACHE_MS = 60_000;

async function call<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  if (!authentik) throw new HttpError(503, "Authentik isn't configured");
  let res: Response;
  try {
    res = await fetch(`${authentik.url}/api/v3${path}`, {
      method: init?.method ?? "GET",
      headers: {
        Authorization: `Bearer ${authentik.token}`,
        Accept: "application/json",
        ...(init?.body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
      signal: AbortSignal.timeout(10_000),
    });
  } catch (e) {
    console.warn(`Authentik ${path}:`, e);
    throw new HttpError(503, "Authentik can't be reached right now");
  }
  if (res.status === 204) return undefined as T;
  const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
  if (!res.ok) {
    const message = authentikError(data);
    if (res.status === 400) throw new HttpError(400, message ?? "Authentik refused the change");
    if (res.status === 404) throw new HttpError(404, "Not found in Authentik");
    console.warn(`Authentik ${path} answered ${res.status}:`, data);
    // 401/403: the service token is wrong or lacks a permission; not the visitor's fault.
    throw new HttpError(503, res.status === 401 || res.status === 403 ? "The Authentik token was refused (check AUTHENTIK_TOKEN and its permissions)" : `Authentik answered ${res.status}`);
  }
  return data as T;
}

/** The first readable message in a DRF error body ({password: ["…"]}, {detail: "…"}, …). */
function authentikError(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  for (const v of Object.values(data)) {
    if (typeof v === "string") return v;
    if (Array.isArray(v) && typeof v[0] === "string") return v[0];
    if (Array.isArray(v) && v[0] && typeof v[0] === "object" && typeof (v[0] as { string?: unknown }).string === "string") return (v[0] as { string: string }).string;
  }
  return null;
}

/** Icons are stored as "/media/…" paths on Authentik, full URLs, or "fa://" Font Awesome names (not shown). */
function iconUrl(icon: unknown): string | null {
  if (typeof icon !== "string" || !icon || icon.startsWith("fa://")) return null;
  if (/^https?:\/\//.test(icon)) return icon;
  if (icon.startsWith("/") && authentik) return `${authentik.url}${icon}`;
  return null;
}

interface RawUser {
  pk: number;
  username: string;
  name: string;
  email: string;
  is_active: boolean;
  is_superuser: boolean;
  avatar?: string;
  groups_obj?: { name: string }[] | null;
  last_login?: string | null;
  date_joined?: string | null;
  password_change_date?: string | null;
}

const toUser = (u: RawUser): AkUser => ({
  pk: u.pk,
  username: u.username,
  name: u.name ?? "",
  email: u.email ?? "",
  isActive: u.is_active,
  isSuperuser: !!u.is_superuser,
  // Authentik's default avatar is an inline SVG data: URL, or a Gravatar link.
  avatar: typeof u.avatar === "string" && /^(https?:|data:image\/)/.test(u.avatar) ? u.avatar : null,
  groups: (u.groups_obj ?? []).map((g) => g.name).sort((a, b) => a.localeCompare(b)),
  lastLogin: u.last_login ?? null,
  dateJoined: u.date_joined ?? null,
  passwordChangeDate: u.password_change_date ?? null,
});

const users = new Map<number, { user: AkUser; until: number }>();
const apps = new Map<number, { apps: AkApp[]; until: number }>();

/** The Authentik account behind a sign-in (by username, then email). */
export async function findUser(username: string | undefined, email: string | undefined): Promise<AkUser | null> {
  if (!authentik) return devUser(username);
  const search = async (q: Record<string, string>) =>
    (await call<{ results: RawUser[] }>(`/core/users/?${new URLSearchParams({ ...q, page_size: "2" })}`)).results;
  let found = username ? (await search({ username })).filter((u) => u.username === username) : [];
  if (!found.length && email) found = (await search({ email })).filter((u) => u.email.toLowerCase() === email.toLowerCase());
  return found.length === 1 ? toUser(found[0]) : null;
}

/** Fresh enough (a minute) to notice a deactivated account or a profile an admin edited. */
export async function getUser(pk: number, fresh = false): Promise<AkUser | null> {
  const hit = users.get(pk);
  if (!fresh && hit && hit.until > Date.now()) return hit.user;
  let user: AkUser | null;
  if (!authentik) user = devUser(DEV_LOGIN_USER ?? undefined);
  else {
    try {
      user = toUser(await call<RawUser>(`/core/users/${pk}/`));
    } catch (e) {
      if (e instanceof HttpError && e.status === 404) user = null;
      else throw e;
    }
  }
  if (user) users.set(pk, { user, until: Date.now() + CACHE_MS });
  else users.delete(pk);
  return user;
}

interface RawApp {
  pk: string;
  slug: string;
  name: string;
  launch_url?: string | null;
  meta_launch_url?: string;
  meta_icon?: string | null;
  meta_icon_url?: string | null;
  meta_description?: string;
  meta_publisher?: string;
  group?: string;
  open_in_new_tab?: boolean;
}

/** The applications `pk` may open, as Authentik's library shows them (those with a launch URL). */
export async function appsFor(pk: number, fresh = false): Promise<AkApp[]> {
  const hit = apps.get(pk);
  if (!fresh && hit && hit.until > Date.now()) return hit.apps;
  if (!authentik) return DEV_APPS;

  const out: AkApp[] = [];
  // Authentik filters each page by policy after paginating, so pages can come back short: follow `next`.
  for (let page = 1; page && page <= 50; ) {
    const q = new URLSearchParams({ for_user: String(pk), only_with_launch_url: "true", ordering: "name", page_size: "100", page: String(page) });
    const res = await call<{ pagination: { next: number }; results: RawApp[] }>(`/core/applications/?${q}`);
    for (const a of res.results) {
      const url = a.launch_url || a.meta_launch_url;
      if (!url || !/^https?:\/\//.test(url)) continue;
      out.push({
        id: a.slug,
        slug: a.slug,
        name: a.name,
        url,
        description: a.meta_description ?? "",
        publisher: a.meta_publisher ?? "",
        icon: iconUrl(a.meta_icon_url ?? a.meta_icon),
        group: a.group ?? "",
        newTab: !!a.open_in_new_tab,
      });
    }
    page = res.pagination?.next ?? 0;
  }
  apps.set(pk, { apps: out, until: Date.now() + CACHE_MS });
  return out;
}

export async function setPassword(pk: number, password: string): Promise<void> {
  if (!authentik) {
    if (DEV_LOGIN_USER) return;
    throw new HttpError(503, "Authentik isn't configured");
  }
  await call(`/core/users/${pk}/set_password/`, { method: "POST", body: { password } });
  users.delete(pk);
}

// --- Two-factor devices ---

export type DeviceKind = "totp" | "webauthn" | "other";

export interface AkDevice {
  id: string;
  kind: DeviceKind;
  name: string;
  /** Authentik's name for the type ("TOTP Device", "WebAuthn Device", "Static Device"). */
  typeName: string;
  /** For passkeys: the authenticator model when Authentik knows it ("iCloud Keychain", "YubiKey 5"). */
  description: string | null;
  created: string | null;
  lastUsed: string | null;
}

interface RawDevice {
  pk: string | number;
  name: string;
  type: string;
  confirmed?: boolean;
  verbose_name?: string;
  created?: string | null;
  last_used?: string | null;
  extra_description?: string | null;
}

const kindOf = (type: string): DeviceKind => (/\.TOTPDevice$/.test(type) ? "totp" : /\.WebAuthnDevice$/.test(type) ? "webauthn" : "other");

/** Every confirmed authenticator `pk` has (authenticator apps, passkeys, recovery codes…). Never cached. */
export async function devicesFor(pk: number): Promise<AkDevice[]> {
  if (!authentik) return DEV_DEVICES;
  const raw = await call<RawDevice[]>(`/authenticators/admin/all/?user=${pk}`);
  return raw
    .filter((d) => d.confirmed !== false)
    .map((d) => ({
      id: String(d.pk),
      kind: kindOf(d.type),
      name: d.name,
      typeName: d.verbose_name ?? d.type,
      description: d.extra_description ?? null,
      created: d.created ?? null,
      lastUsed: d.last_used ?? null,
    }));
}

/** Removes one of `pk`'s authenticator apps or passkeys (checked to be theirs first). */
export async function deleteDevice(pk: number, kind: "totp" | "webauthn", id: string): Promise<void> {
  const mine = (await devicesFor(pk)).some((d) => d.kind === kind && d.id === id);
  if (!mine) throw new HttpError(404, "That authenticator doesn't exist");
  if (!authentik) {
    DEV_DEVICES.splice(
      DEV_DEVICES.findIndex((d) => d.kind === kind && d.id === id),
      1,
    );
    return;
  }
  await call(`/authenticators/admin/${kind}/${encodeURIComponent(id)}/`, { method: "DELETE" });
}

/** Local development: "setting up" adds a sample device straight away. */
export function devAddDevice(kind: "totp" | "webauthn") {
  DEV_DEVICES.push({
    id: String(Date.now()),
    kind,
    name: kind === "totp" ? "Authenticator app" : "Passkey",
    typeName: kind === "totp" ? "TOTP Device" : "WebAuthn Device",
    description: kind === "webauthn" ? "iCloud Keychain" : null,
    created: new Date().toISOString(),
    lastUsed: null,
  });
}

export function forget(pk: number) {
  users.delete(pk);
  apps.delete(pk);
}

// --- Local development stand-in (DEV_LOGIN_USER) ---

function devUser(username: string | undefined): AkUser | null {
  if (!DEV_LOGIN_USER || (username && username !== DEV_LOGIN_USER)) return null;
  return {
    pk: 1,
    username: DEV_LOGIN_USER,
    name: "Demo User",
    email: `${DEV_LOGIN_USER}@example.com`,
    isActive: true,
    isSuperuser: false,
    avatar: null,
    groups: ["Family", "Developers"],
    lastLogin: new Date().toISOString(),
    dateJoined: "2025-03-14T09:30:00Z",
    passwordChangeDate: "2026-06-01T12:00:00Z",
  };
}

const DEV_DEVICES: AkDevice[] = [
  { id: "1", kind: "totp", name: "Phone", typeName: "TOTP Device", description: null, created: "2025-04-02T10:00:00Z", lastUsed: "2026-10-18T08:12:00Z" },
  { id: "2", kind: "other", name: "Recovery codes", typeName: "Static Device", description: null, created: "2025-04-02T10:01:00Z", lastUsed: null },
];

const DEV_APPS: AkApp[] = [
  { id: "notes", slug: "notes", name: "Notes", url: "https://notes.bayfield.dev", description: "Documents and notes, with live collaboration.", publisher: "Bayfield", icon: null, group: "Productivity", newTab: false },
  { id: "calendar", slug: "calendar", name: "Calendar", url: "https://calendar.bayfield.dev", description: "Calendars, events and booking pages.", publisher: "Bayfield", icon: null, group: "Productivity", newTab: false },
  { id: "devtime", slug: "devtime", name: "DevTime", url: "https://dev.bayfield.dev", description: "Coding time from your editors: projects, languages, goals.", publisher: "Bayfield", icon: null, group: "Development", newTab: false },
  { id: "internal", slug: "internal", name: "Internal", url: "https://internal.bayfield.dev", description: "Internal tools.", publisher: "Bayfield", icon: null, group: "Administration", newTab: true },
];
