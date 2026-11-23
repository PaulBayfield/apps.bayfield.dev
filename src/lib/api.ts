// Talking to the Apps server (same origin; Vite proxies /api in development).

export class ApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function api<T>(path: string, init?: { method?: string; body?: unknown }): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init?.method ?? (init?.body !== undefined ? "POST" : "GET"),
    headers: init?.body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: init?.body !== undefined ? JSON.stringify(init.body) : undefined,
    credentials: "same-origin",
  });
  if (!res.ok) {
    const data = await res.json().catch(() => null);
    if (res.status === 401 && !path.startsWith("/auth/")) window.dispatchEvent(new Event("apps:signed-out"));
    throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`);
  }
  return res.status === 204 ? (undefined as T) : res.json();
}

// --- Types (mirroring the server) ---

/** The signed-in Authentik user. Only the password can be changed here. */
export interface Me {
  username: string;
  name: string;
  email: string;
  avatar: string | null;
  groups: string[];
  isSuperuser: boolean;
  lastLogin: string | null;
  dateJoined: string | null;
  passwordChangeDate: string | null;
  /** Until then the password can be changed without signing in again. */
  recentAuthUntil: string;
  authentikUrl: string | null;
}

export interface App {
  /** "public:<id>" or "authentik:<slug>". */
  id: string;
  name: string;
  url: string;
  description: string;
  publisher: string;
  icon: string | null;
  category: string;
  access: "public" | "private";
  newTab: boolean;
}

export interface AppList {
  apps: App[];
  signedIn: boolean;
}

export interface AuthConfig {
  oidc: { name: string } | null;
  /** Local development sign-in (DEV_LOGIN_USER). */
  dev: boolean;
}

export interface ServerInfo {
  version: string;
  oidc: { name: string } | null;
  authentikUrl: string | null;
  passwordMinLength: number;
}

/** GET /updates: whether a newer release is out on GitHub. */
export interface UpdateStatus {
  current: string;
  latest: { version: string; url: string; publishedAt: string | null } | null;
  available: boolean;
  releasesUrl: string;
  checkedAt: string | null;
  /** UPDATE_CHECK=false on the server. */
  disabled?: boolean;
  error?: string;
}

/** "notes.bayfield.dev" from "https://notes.bayfield.dev/". */
export function hostOf(url: string): string {
  try {
    const u = new URL(url);
    return (u.host + u.pathname).replace(/\/+$/, "");
  } catch {
    return url;
  }
}

/** One of the user's authenticators in Authentik. */
export interface MfaDevice {
  id: string;
  /** "other": recovery codes and the like, shown but managed in Authentik. */
  kind: "totp" | "webauthn" | "other";
  name: string;
  typeName: string;
  /** Passkeys: the authenticator model when known ("iCloud Keychain"). */
  description: string | null;
  created: string | null;
  lastUsed: string | null;
}

export interface MfaStatus {
  devices: MfaDevice[];
  /** At least one authenticator app or passkey. */
  enabled: boolean;
}

/** GET /apps/access: why the user can open a private app (its policy bindings in Authentik). */
export interface AppAccess {
  /** No bindings: anyone who can sign in. */
  everyone: boolean;
  /** "all": each binding must pass. */
  mode: "any" | "all";
  /** The bound groups the user is in; `via`: their own group, when the bound one is its parent. */
  groups: { name: string; via: string | null }[];
  /** A binding names the user directly. */
  user: boolean;
  /** Policies bound to the app (what they decide isn't known here). */
  policies: string[];
}

// --- Admin pages (Authentik superusers only) ---

export type AdminWarning = "events" | "mfa" | "apps";

/** One day of the chosen period, in the viewer's time zone. */
export interface DayPoint {
  /** YYYY-MM-DD */
  day: string;
  logins: number;
  failed: number;
  appOpens: number;
  /** Distinct accounts that signed in or opened an app. */
  users: number;
}

export interface AdminOverview {
  days: number;
  generatedAt: string;
  warnings: AdminWarning[];
  /** More events than the server reads per period (only the latest were counted). */
  truncated: boolean;
  users: {
    total: number;
    active: number;
    inactive: number;
    superusers: number;
    serviceAccounts: number;
    /** Null: the authenticators couldn't be read. */
    withMfa: number | null;
    neverSignedIn: number;
    seen1d: number;
    seen7d: number;
    seen30d: number;
    joinedInRange: number;
  };
  totals: { logins: number; failed: number; appOpens: number; activeUsers: number };
  series: DayPoint[];
  apps: { name: string; icon: string | null; opens: number; users: number }[];
  topUsers: { pk: number; username: string; name: string; avatar: string | null; logins: number; appOpens: number; lastSeen: string | null }[];
  failed: { byUsername: { key: string; count: number; known: boolean }[]; byIp: { key: string; country: string | null; count: number }[] };
  countries: { key: string; count: number }[];
}

export interface MfaSummary {
  totp: number;
  webauthn: number;
  other: number;
}

export interface AdminUserRow {
  pk: number;
  username: string;
  name: string;
  email: string;
  avatar: string | null;
  isActive: boolean;
  isSuperuser: boolean;
  kind: "person" | "service";
  groups: string[];
  dateJoined: string | null;
  passwordChangeDate: string | null;
  lastSeen: string | null;
  logins: number;
  appOpens: number;
  failed: number;
  /** Null: unknown (deactivated, service account, or not readable). */
  mfa: MfaSummary | null;
}

export interface AdminUsers {
  days: number;
  warnings: AdminWarning[];
  truncated: boolean;
  users: AdminUserRow[];
}

export interface UsageEvent {
  id: string;
  kind: "login" | "failed" | "app";
  at: string;
  pk: number | null;
  /** The account's username, or what was typed in for a failed sign-in. */
  username: string;
  app: string | null;
  ip: string | null;
  country: string | null;
  city: string | null;
  userAgent: string | null;
}

export interface AdminEvents {
  days: number;
  warnings: AdminWarning[];
  truncated: boolean;
  total: number;
  events: UsageEvent[];
}

export interface AdminUserDetail {
  days: number;
  warnings: AdminWarning[];
  truncated: boolean;
  user: Omit<AdminUserRow, "logins" | "appOpens" | "failed" | "mfa"> & { lastLogin: string | null };
  totals: { logins: number; appOpens: number; failed: number };
  series: DayPoint[];
  devices: MfaDevice[] | null;
  apps: { slug: string; name: string; icon: string | null; url: string; opens: number; lastOpened: string | null }[] | null;
  events: UsageEvent[];
  /** The user's page in Authentik's admin interface. */
  adminUrl: string | null;
}
