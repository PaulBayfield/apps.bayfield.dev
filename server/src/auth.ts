// Sign-in with Authentik (OIDC authorization code + PKCE) and sessions.
//
// No database: the session is a sealed cookie (see crypto.ts) holding the Authentik user's pk and
// when they last proved who they are. Each request re-checks the account with Authentik (cached a
// minute), so a deactivated or deleted user is signed out right away.

import { createHash } from "node:crypto";
import { Hono, type Context, type Next } from "hono";
import { deleteCookie, getCookie, setCookie } from "hono/cookie";
import { DEV_LOGIN_USER, PUBLIC_URL, REAUTH_MINUTES, SECURE_COOKIES, SESSION_DAYS, authentik, oidc } from "./config.ts";
import { randomToken, seal, unseal } from "./crypto.ts";
import { findUser, getUser, type AkUser } from "./authentik.ts";
import { HttpError, rateLimit } from "./http.ts";

interface SessionData {
  pk: number;
  /** When the user last signed in at Authentik (ms): a recent one is needed to change the password. */
  authAt: number;
  exp: number;
}

interface OidcState {
  state: string;
  verifier: string;
  nonce: string;
  next: string;
  reauth: boolean;
  exp: number;
}

export type AppEnv = { Variables: { user: AkUser | null; session: SessionData | null } };

const SESSION = SECURE_COOKIES ? "__Host-apps" : "apps";
const STATE = SECURE_COOKIES ? "__Host-apps-oidc" : "apps-oidc";
const DAY = 24 * 60 * 60_000;
const cookieOptions = { httpOnly: true, secure: SECURE_COOKIES, sameSite: "Lax" as const, path: "/" };

function startSession(c: Context, pk: number, authAt: number) {
  const data: SessionData = { pk, authAt, exp: Date.now() + SESSION_DAYS * DAY };
  setCookie(c, SESSION, seal(data), { ...cookieOptions, maxAge: SESSION_DAYS * 24 * 60 * 60 });
}

function endSession(c: Context) {
  deleteCookie(c, SESSION, { path: "/", secure: SECURE_COOKIES });
}

/** Sets `user` (null when signed out) for every /api request. */
export async function loadUser(c: Context<AppEnv>, next: Next) {
  const s = unseal<SessionData>(getCookie(c, SESSION));
  let user: AkUser | null = null;
  if (s && s.exp > Date.now()) {
    user = await getUser(s.pk);
    if (!user?.isActive) {
      user = null;
      endSession(c);
    }
  } else if (s) endSession(c);
  c.set("user", user);
  c.set("session", user ? s : null);
  await next();
}

export async function requireUser(c: Context<AppEnv>, next: Next) {
  if (!c.get("user")) throw new HttpError(401, "Not signed in");
  await next();
}

/** Until when the current sign-in counts as recent (ms), for changes that need it. */
export const recentUntil = (s: SessionData) => s.authAt + REAUTH_MINUTES * 60_000;

/**
 * Cookie-authenticated writes must come from the app itself. Browsers send Origin on every
 * cross-site POST, so a mismatch means another site is trying to act as the user.
 */
export async function sameOrigin(c: Context, next: Next) {
  if (c.req.method !== "GET" && c.req.method !== "HEAD") {
    const origin = c.req.header("Origin");
    const site = c.req.header("Sec-Fetch-Site");
    const allowed = new URL(PUBLIC_URL).origin;
    if ((origin && origin !== allowed && !isDevOrigin(origin)) || (!origin && site && site !== "same-origin" && site !== "none")) {
      throw new HttpError(403, "Cross-site request blocked");
    }
  }
  await next();
}

const isDevOrigin = (o: string) => process.env.NODE_ENV !== "production" && /^http:\/\/localhost:\d+$/.test(o);

/** Only paths on this site ("/…", not "//host" or "/\host"). */
const safeNext = (v: string | undefined) => (v && /^\/(?![/\\])/.test(v) ? v : "/");

export function meView(user: AkUser, s: SessionData) {
  return {
    username: user.username,
    name: user.name,
    email: user.email,
    avatar: user.avatar,
    groups: user.groups,
    isSuperuser: user.isSuperuser,
    lastLogin: user.lastLogin,
    dateJoined: user.dateJoined,
    passwordChangeDate: user.passwordChangeDate,
    /** Until then the password can be changed without signing in again. */
    recentAuthUntil: new Date(recentUntil(s)).toISOString(),
    authentikUrl: authentik?.url ?? null,
  };
}

// --- OIDC ---

interface Discovery {
  authorization_endpoint: string;
  token_endpoint: string;
  userinfo_endpoint: string;
  issuer: string;
}
let discovery: Promise<Discovery> | null = null;
function discover(): Promise<Discovery> {
  if (!oidc) throw new HttpError(404, "Sign-in isn't configured");
  const url = `${oidc.issuer}/.well-known/openid-configuration`;
  discovery ??= fetch(url, { signal: AbortSignal.timeout(10_000) })
    .then((r) => {
      if (!r.ok) throw new Error(`OIDC discovery failed (${r.status} from ${JSON.stringify(url)}): check OIDC_ISSUER`);
      return r.json() as Promise<Discovery>;
    })
    .catch((e) => {
      discovery = null;
      throw e;
    });
  return discovery;
}

const challenge = (verifier: string) => createHash("sha256").update(verifier).digest().toString("base64url");

function decodeJwt(token: string): Record<string, unknown> {
  const payload = token.split(".")[1];
  if (!payload) throw new Error("Malformed ID token");
  return JSON.parse(Buffer.from(payload, "base64url").toString("utf8"));
}

// --- Routes ---

export const authRoutes = new Hono<AppEnv>();

authRoutes.get("/config", (c) => c.json({ oidc: oidc ? { name: oidc.name } : null, dev: !!DEV_LOGIN_USER }));

authRoutes.get("/me", requireUser, (c) => c.json(meView(c.get("user")!, c.get("session")!)));

authRoutes.post("/logout", (c) => {
  endSession(c);
  return c.json({ ok: true });
});

/** `?reauth=1` makes Authentik ask for the password again (before a password change); `?next=/path` returns there. */
authRoutes.get("/oidc/start", async (c) => {
  rateLimit(c, "signin", 30, 10 * 60_000);
  const url = await authorizeUrl(c, { next: c.req.query("next"), reauth: c.req.query("reauth") === "1" });
  return c.redirect(url.toString());
});

/**
 * The authorization request for this app, remembering where to come back to (in a sealed cookie).
 * `minutes`: how long the round trip may take (longer when it goes through a setup flow first).
 */
export async function authorizeUrl(c: Context, opts: { next?: string; reauth?: boolean; minutes?: number }): Promise<URL> {
  const d = await discover();
  const reauth = !!opts.reauth;
  const minutes = opts.minutes ?? 10;
  const st: OidcState = {
    state: randomToken(24),
    verifier: randomToken(48),
    nonce: randomToken(16),
    next: safeNext(opts.next),
    reauth,
    exp: Date.now() + minutes * 60_000,
  };
  setCookie(c, STATE, seal(st), { ...cookieOptions, maxAge: minutes * 60 });
  const url = new URL(d.authorization_endpoint);
  url.search = new URLSearchParams({
    response_type: "code",
    client_id: oidc!.clientId,
    redirect_uri: oidc!.redirectUri,
    scope: "openid profile email",
    state: st.state,
    nonce: st.nonce,
    code_challenge: challenge(st.verifier),
    code_challenge_method: "S256",
    ...(reauth ? { prompt: "login", max_age: "0" } : {}),
  }).toString();
  return url;
}

authRoutes.get("/oidc/callback", async (c) => {
  const st = unseal<OidcState>(getCookie(c, STATE));
  deleteCookie(c, STATE, { path: "/", secure: SECURE_COOKIES });
  const back = (path: string, error?: string) => {
    if (!error) return c.redirect(path);
    const u = new URL(path, PUBLIC_URL);
    u.searchParams.set("signin_error", error);
    return c.redirect(u.pathname + u.search);
  };
  const { code, state, error, error_description } = c.req.query();
  if (error) return back(st?.next ?? "/", error_description || error);
  if (!code || !state) return back("/", "The sign-in response was incomplete.");
  if (!st || st.state !== state || st.exp < Date.now()) return back("/", "This sign-in link has expired. Try again.");

  try {
    const d = await discover();
    const tokenRes = await fetch(d.token_endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code,
        redirect_uri: oidc!.redirectUri,
        client_id: oidc!.clientId,
        client_secret: oidc!.clientSecret,
        code_verifier: st.verifier,
      }),
      signal: AbortSignal.timeout(10_000),
    });
    const token = (await tokenRes.json().catch(() => ({}))) as { access_token?: string; id_token?: string; error_description?: string };
    if (!tokenRes.ok || !token.access_token || !token.id_token) throw new Error(token.error_description ?? `Token exchange failed (${tokenRes.status})`);

    // The ID token came straight from the token endpoint over TLS, so checking its claims is enough (OIDC Core 3.1.3.7).
    const id = decodeJwt(token.id_token);
    const aud = Array.isArray(id.aud) ? id.aud : [id.aud];
    if (id.iss !== d.issuer || !aud.includes(oidc!.clientId) || id.nonce !== st.nonce) throw new Error("The ID token doesn't match this app");
    if (typeof id.exp === "number" && id.exp * 1000 < Date.now() - 60_000) throw new Error("The ID token has expired");

    const infoRes = await fetch(d.userinfo_endpoint, { headers: { Authorization: `Bearer ${token.access_token}` }, signal: AbortSignal.timeout(10_000) });
    const info = (await infoRes.json().catch(() => ({}))) as { sub?: string; preferred_username?: string; email?: string };
    if (!infoRes.ok || info.sub !== id.sub) throw new Error("Couldn't read your profile from Authentik");

    const user = await findUser(info.preferred_username, info.email);
    if (!user) throw new Error("Your Authentik account couldn't be found. Check that the provider sends preferred_username.");
    if (!user.isActive) throw new Error("Your account is deactivated.");

    // auth_time: when the user last entered their credentials at Authentik (not when the token was issued).
    const authAt = typeof id.auth_time === "number" ? id.auth_time * 1000 : Date.now();
    if (st.reauth && Date.now() - authAt > 5 * 60_000) throw new Error("Authentik didn't ask for your password again. Try once more.");
    startSession(c, user.pk, authAt);
    return back(st.next);
  } catch (e) {
    console.warn("OIDC sign-in failed:", e);
    return back(st.next, e instanceof Error ? e.message : "Sign-in failed");
  }
});

/** Local development only (see DEV_LOGIN_USER): signs in without Authentik. */
authRoutes.post("/dev-login", async (c) => {
  if (!DEV_LOGIN_USER) throw new HttpError(404, "Not found");
  const user = await findUser(DEV_LOGIN_USER, undefined);
  startSession(c, user!.pk, Date.now());
  return c.json({ ok: true });
});
