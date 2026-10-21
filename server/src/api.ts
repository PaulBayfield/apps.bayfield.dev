// The hub's API. The app list and server info are public; the account routes need a session.

import { Hono } from "hono";
import { APP_VERSION, DEV_LOGIN_USER, PASSWORD_MIN_LENGTH, UPDATE_CHECK, authentik, oidc } from "./config.ts";
import { authorizeUrl, recentUntil, requireUser, type AppEnv } from "./auth.ts";
import { deleteDevice, devAddDevice, devicesFor, forget, setPassword } from "./authentik.ts";
import { catalog } from "./catalog.ts";
import { HttpError, bad, body, rateLimit } from "./http.ts";
import { RELEASES_URL, updateStatus } from "./updates.ts";

export const api = new Hono<AppEnv>();

/** Public apps for everyone; plus, signed in, the Authentik apps this user may open. `?refresh=1` asks Authentik again. */
api.get("/apps", async (c) => {
  const user = c.get("user");
  const fresh = c.req.query("refresh") === "1";
  if (fresh) rateLimit(c, "apps-refresh", 20, 60_000);
  return c.json({ apps: await catalog(user?.pk ?? null, fresh), signedIn: !!user });
});

api.get("/server", (c) =>
  c.json({
    version: APP_VERSION,
    oidc: oidc ? { name: oidc.name } : null,
    authentikUrl: authentik?.url ?? null,
    passwordMinLength: PASSWORD_MIN_LENGTH,
  }),
);

/** Whether a newer release is out. `?refresh=1` skips the cache (the "Check for updates" button). */
api.get("/updates", async (c) => {
  if (!UPDATE_CHECK) return c.json({ current: APP_VERSION, latest: null, available: false, releasesUrl: RELEASES_URL, checkedAt: null, disabled: true });
  const force = c.req.query("refresh") === "1";
  if (force) rateLimit(c, "updates", 10, 60 * 60_000);
  return c.json(await updateStatus(force));
});

/**
 * A new password, set in Authentik. Everything else on the profile is the admins' to change.
 * Needs a recent sign-in (REAUTH_MINUTES), so a forgotten open session can't be used to take the account over.
 */
api.post("/account/password", requireUser, async (c) => {
  const user = c.get("user")!;
  const session = c.get("session")!;
  rateLimit(c, `password:${user.pk}`, 5, 15 * 60_000);
  if (Date.now() > recentUntil(session)) throw new HttpError(403, "Sign in again to change your password");
  const { password } = await body(c);
  if (typeof password !== "string") throw bad();
  if (password.length < PASSWORD_MIN_LENGTH) throw bad(`Use at least ${PASSWORD_MIN_LENGTH} characters`);
  if (password.length > 512) throw bad("That password is too long");
  if (password.trim() !== password) throw bad("The password can't start or end with a space");
  if (password.toLowerCase() === user.username.toLowerCase() || password.toLowerCase() === user.email.toLowerCase()) {
    throw bad("The password can't be your username or email");
  }
  await setPassword(user.pk, password);
  forget(user.pk);
  return c.json({ ok: true });
});

// --- Two-factor authentication ---

/** The user's authenticators. "enabled": at least one authenticator app or passkey. */
api.get("/account/mfa", requireUser, async (c) => {
  const devices = await devicesFor(c.get("user")!.pk);
  return c.json({ devices, enabled: devices.some((d) => d.kind !== "other") });
});

/**
 * Adding an authenticator happens in Authentik's own setup flow (it holds the secrets, and passkeys
 * are bound to its domain). Authentik only returns to paths on itself after a flow, so `next` is
 * this app's authorize URL there: the user, already signed in, bounces straight back here.
 */
api.get("/account/mfa/setup", requireUser, async (c) => {
  const kind = c.req.query("kind");
  if (kind !== "totp" && kind !== "webauthn") throw bad();
  rateLimit(c, "mfa-setup", 20, 10 * 60_000);
  const back = "/?settings=security";
  if (!authentik) {
    if (!DEV_LOGIN_USER) throw new HttpError(503, "Authentik isn't configured");
    devAddDevice(kind);
    return c.redirect(back);
  }
  const flow = new URL(`${authentik.url}/if/flow/${encodeURIComponent(kind === "totp" ? authentik.totpFlow : authentik.webauthnFlow)}/`);
  const authorize = await authorizeUrl(c, { next: back, minutes: 30 });
  // Only a path on Authentik itself is accepted as `next`.
  if (authorize.origin === flow.origin) flow.searchParams.set("next", authorize.pathname + authorize.search);
  return c.redirect(flow.toString());
});

/** Removing one needs a recent sign-in, like changing the password. */
api.delete("/account/mfa/:kind/:id", requireUser, async (c) => {
  const user = c.get("user")!;
  const kind = c.req.param("kind");
  if (kind !== "totp" && kind !== "webauthn") throw bad();
  rateLimit(c, `mfa-delete:${user.pk}`, 10, 15 * 60_000);
  if (Date.now() > recentUntil(c.get("session")!)) throw new HttpError(403, "Sign in again to remove an authenticator");
  await deleteDevice(user.pk, kind, c.req.param("id") ?? "");
  return c.json({ ok: true });
});
