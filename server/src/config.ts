// Server configuration, read once from the environment (see server/.env.example).

import { readFileSync } from "node:fs";
import { resolve } from "node:path";

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing environment variable ${name} (see server/.env.example)`);
  return value;
}

const flag = (name: string, fallback: boolean) => {
  const v = process.env[name]?.trim().toLowerCase();
  return v ? v === "true" || v === "1" || v === "yes" : fallback;
};

/** Tolerates what .env files tend to add: spaces, a CR from Windows line endings, quotes. */
const url = (v: string) =>
  v
    .trim()
    .replace(/^["']|["']$/g, "")
    .replace(/\/+$/, "");

export const PUBLIC_URL = url(required("PUBLIC_URL"));
export const PORT = Number(process.env.PORT ?? 8791);
export const DIST_DIR = resolve(process.env.DIST_DIR ?? resolve(import.meta.dirname, "../../dist"));
export const SECURE_COOKIES = PUBLIC_URL.startsWith("https://");

/** The public apps everyone sees, signed in or not. Re-read when the file changes. */
export const APPS_FILE = resolve(process.env.APPS_FILE ?? resolve(import.meta.dirname, "../../config/apps.json"));

/** Set by the Docker build; when running from a checkout, the root package.json's version. */
export const APP_VERSION = (() => {
  const env = process.env.APP_VERSION?.trim();
  if (env && env !== "dev") return env;
  try {
    return (JSON.parse(readFileSync(resolve(import.meta.dirname, "../../package.json"), "utf8")) as { version?: string }).version ?? "dev";
  } catch {
    return "dev";
  }
})();

/** Look on GitHub for a newer release (shown in Settings → About). */
export const UPDATE_CHECK = flag("UPDATE_CHECK", true);

/** Signs the session cookies. Changing it signs everyone out. */
export const SESSION_SECRET = (() => {
  const s = required("SESSION_SECRET");
  if (s.length < 32) throw new Error("SESSION_SECRET must be at least 32 characters (openssl rand -base64 32)");
  return s;
})();

/** How long a sign-in lasts. */
export const SESSION_DAYS = Number(process.env.SESSION_DAYS ?? 30);

/** Changing the password needs a sign-in at most this recent (minutes); older ones confirm first. */
export const REAUTH_MINUTES = Number(process.env.REAUTH_MINUTES ?? 10);

export const PASSWORD_MIN_LENGTH = Number(process.env.PASSWORD_MIN_LENGTH ?? 8);

/**
 * Local development only: signs straight in as this user with sample private apps, without
 * Authentik. Ignored unless PUBLIC_URL is localhost, so it can't be switched on in production by mistake.
 */
export const DEV_LOGIN_USER = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(PUBLIC_URL) ? process.env.DEV_LOGIN_USER?.trim() || null : null;

/** Sign in with Authentik (OIDC). Without it, only the public apps are shown. */
export const oidc = process.env.OIDC_ISSUER
  ? {
      issuer: url(process.env.OIDC_ISSUER),
      clientId: required("OIDC_CLIENT_ID"),
      clientSecret: required("OIDC_CLIENT_SECRET"),
      /** Shown on the sign-in button. */
      name: process.env.OIDC_NAME?.trim() || "Authentik",
      redirectUri: `${PUBLIC_URL}/api/auth/oidc/callback`,
    }
  : null;

/**
 * The Authentik API: which applications each user may open, their profile, and password changes.
 * The token belongs to a service account allowed to view users, their applications, and reset passwords.
 */
export const authentik = oidc
  ? {
      url: url(process.env.AUTHENTIK_URL ?? new URL(oidc.issuer).origin),
      token: required("AUTHENTIK_TOKEN"),
      /** The flows users add an authenticator app or a passkey with (Authentik's defaults). */
      totpFlow: process.env.AUTHENTIK_TOTP_FLOW?.trim() || "default-authenticator-totp-setup",
      webauthnFlow: process.env.AUTHENTIK_WEBAUTHN_FLOW?.trim() || "default-authenticator-webauthn-setup",
    }
  : null;

if (!oidc && !DEV_LOGIN_USER) {
  console.warn("OIDC_ISSUER isn't set: sign-in is off and only the public apps are listed.");
}

/** Header your reverse proxy puts the visitor IP in (e.g. cf-connecting-ip). Unset: the TCP peer. */
export const CLIENT_IP_HEADER = process.env.CLIENT_IP_HEADER?.toLowerCase();
