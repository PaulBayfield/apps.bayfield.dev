// The Authentik account: everything shown; the user changes only their password and their
// two-factor authenticators (the rest is the admins').

import { useEffect, useState, type ReactNode } from "react";
import { api, ApiError, type MfaDevice, type MfaStatus } from "../../lib/api";
import { useApp, type SettingsPage } from "../../lib/app";
import { invalidate, useApi } from "../../lib/hooks";
import { useSettings } from "../../lib/settings";
import { Avatar, Dialog, useToast } from "../common";
import { Eye, EyeOff, Fingerprint, Key, Lock, Plus, Shield, ShieldCheck, Smartphone } from "../icons";
import { PageHeader, Row } from "./common";

// --- Account ---

export function AccountPage({ go }: { go: (page: SettingsPage) => void }) {
  const { t, f } = useSettings();
  const { me } = useApp();
  const mfa = useApi<MfaStatus>(me ? "/account/mfa" : null).data;
  if (!me) return null;
  const locked = t("managedByAdmin");
  const date = (d: string | null, fallback = t("unknown")) => (d ? f.longDate(d) : fallback);

  return (
    <>
      <PageHeader title={t("account")} hint={t("accountHint")} />
      <section className="account-card">
        <Avatar name={me.name || me.username} src={me.avatar} size={52} />
        <div className="account-card-text">
          <span className="account-card-name">
            {me.name || me.username}
            {me.isSuperuser && <span className="badge good">{t("administrator")}</span>}
          </span>
          <span className="small muted">{me.email || `@${me.username}`}</span>
        </div>
      </section>
      <section className="settings-rows">
        <Row label={t("username")} hint={locked}>
          <ReadOnly value={me.username} label={t("username")} />
        </Row>
        <Row label={t("nameLabel")} hint={locked}>
          <ReadOnly value={me.name} label={t("nameLabel")} />
        </Row>
        <Row label={t("emailLabel")} hint={locked}>
          <ReadOnly value={me.email} label={t("emailLabel")} />
        </Row>
        <Row label={t("groups")} hint={locked}>
          <span className="readonly-badges" aria-disabled="true">
            {me.groups.length ? me.groups.map((g) => <span key={g} className="badge">{g}</span>) : <span className="muted small">{t("noGroups")}</span>}
          </span>
        </Row>
      </section>
      <section className="settings-rows">
        <Row label={t("memberSince")}>
          <span className="muted small">{date(me.dateJoined)}</span>
        </Row>
        <Row label={t("lastSignIn")}>
          <span className="muted small">{me.lastLogin ? f.relative(me.lastLogin, t) : t("never")}</span>
        </Row>
        <Row label={t("password")} hint={me.passwordChangeDate ? `${t("passwordChanged")} ${date(me.passwordChangeDate)}` : undefined}>
          <button className="text-button" onClick={() => go("password")}>
            <Lock size={14} />
            {t("changePassword")}
          </button>
        </Row>
        <Row label={t("twoFactor")} hint={mfa ? (mfa.enabled ? t("twoFactorOn") : t("twoFactorOff")) : undefined}>
          <button className="text-button" onClick={() => go("security")}>
            <Shield size={14} />
            {t("manage")}
          </button>
        </Row>
      </section>
    </>
  );
}

/** Greyed out: shown, selectable, not editable. */
function ReadOnly({ value, label }: { value: string; label: string }) {
  const { t } = useSettings();
  return <input className="text-field" value={value || "—"} readOnly disabled aria-label={label} title={t("managedByAdmin")} />;
}

// --- Password ---

export function PasswordPage() {
  const { t } = useSettings();
  const { me, auth, server, reloadMe } = useApp();
  const toast = useToast();
  const now = useNow();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const min = server?.passwordMinLength ?? 8;
  const provider = auth?.oidc?.name ?? "Authentik";

  if (!me) return null;
  const until = Date.parse(me.recentAuthUntil);
  const recent = now < until;
  const minutesLeft = Math.max(1, Math.ceil((until - now) / 60_000));

  const submit = async () => {
    setError(null);
    if (password.length < min) return setError(t("passwordTooShort", { n: min }));
    if (password !== confirm) return setError(t("passwordsDiffer"));
    setBusy(true);
    try {
      await api("/account/password", { body: { password } });
      setPassword("");
      setConfirm("");
      setDone(true);
      toast(t("passwordSaved"));
      reloadMe();
    } catch (e) {
      // The window closed between loading the page and saving: show the confirm step again.
      if (e instanceof ApiError && e.status === 403) reloadMe();
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={t("password")} hint={t("passwordHint", { name: provider })} />
      {!recent && <ReauthNotice hint={t("reauthHint", { name: provider })} page="password" />}
      <form
        className="password-form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {/* Lets password managers save the new password against the right account. */}
        <input type="text" name="username" autoComplete="username" value={me.username} readOnly hidden />
        <section className={`settings-rows${recent ? "" : " disabled-block"}`}>
          <Row label={t("newPassword")} hint={t("passwordRules", { n: min })} disabled={!recent}>
            <span className="password-field">
              <input
                className="text-field"
                type={show ? "text" : "password"}
                autoComplete="new-password"
                value={password}
                disabled={!recent}
                minLength={min}
                onChange={(e) => {
                  setPassword(e.target.value);
                  setDone(false);
                }}
              />
              <button type="button" className="icon-button small" disabled={!recent} aria-label={show ? t("hide") : t("show")} title={show ? t("hide") : t("show")} onClick={() => setShow(!show)}>
                {show ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </span>
          </Row>
          <Row label={t("confirmPassword")} disabled={!recent}>
            <input
              className="text-field"
              type={show ? "text" : "password"}
              autoComplete="new-password"
              value={confirm}
              disabled={!recent}
              onChange={(e) => setConfirm(e.target.value)}
            />
          </Row>
        </section>
        {error && <p className="error-text">{error}</p>}
        {done && <p className="small muted">{t("passwordSavedHint")}</p>}
        <div className="password-actions">
          {recent && <span className="small muted">{t("reauthValid", { n: minutesLeft })}</span>}
          <div className="toolbar-spacer" />
          <button className="primary-button" disabled={!recent || busy || !password || !confirm}>
            {t("changePassword")}
          </button>
        </div>
      </form>
    </>
  );
}

// --- Shared: recent sign-in ---

/** Re-renders every 15 s, so the recent sign-in window runs out while a page is open. */
function useNow() {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 15_000);
    return () => window.clearInterval(timer);
  }, []);
  return now;
}

/** "Confirm it's you": signs in again at Authentik (asking for the password), then comes back to `page`. */
function ReauthNotice({ hint, page }: { hint: string; page: "password" | "security" }) {
  const { t } = useSettings();
  const { auth, reloadMe } = useApp();
  const reauth = () => {
    if (auth?.oidc) location.href = `/api/auth/oidc/start?reauth=1&next=${encodeURIComponent(`/?settings=${page}`)}`;
    else if (auth?.dev) void api("/auth/dev-login", { method: "POST" }).then(reloadMe);
  };
  return (
    <section className="notice">
      <span className="notice-icon">
        <Shield size={18} />
      </span>
      <div className="notice-text">
        <strong>{t("reauthTitle")}</strong>
        <span className="small muted">{hint}</span>
      </div>
      <button className="primary-button" onClick={reauth}>
        {t("reauthButton")}
      </button>
    </section>
  );
}

// --- Two-factor authentication ---

export function SecurityPage() {
  const { t } = useSettings();
  const { me, auth } = useApp();
  const status = useApi<MfaStatus>("/account/mfa");
  const now = useNow();
  const [removing, setRemoving] = useState<MfaDevice | null>(null);
  const [needReauth, setNeedReauth] = useState(false);
  const provider = auth?.oidc?.name ?? "Authentik";
  if (!me) return null;
  const recent = now < Date.parse(me.recentAuthUntil);
  const devices = status.data?.devices ?? [];
  const reload = () => {
    invalidate("/account/mfa");
    status.reload();
  };
  const remove = (d: MfaDevice) => (recent ? setRemoving(d) : setNeedReauth(true));

  return (
    <>
      <PageHeader title={t("twoFactor")} hint={t("twoFactorHint", { name: provider })} />
      {needReauth && !recent && <ReauthNotice hint={t("reauthRemoveHint", { name: provider })} page="security" />}
      {!status.data ? (
        status.error ? <p className="error-text">{status.error}</p> : <div className="skeleton" style={{ height: 180 }} />
      ) : (
        <>
          <section className={`mfa-status${status.data.enabled ? " on" : ""}`}>
            <span className="notice-icon">{status.data.enabled ? <ShieldCheck size={18} /> : <Shield size={18} />}</span>
            <div className="notice-text">
              <strong>{status.data.enabled ? t("twoFactorOn") : t("twoFactorOff")}</strong>
              <span className="small muted">{status.data.enabled ? t("twoFactorOnHint") : t("twoFactorOffHint")}</span>
            </div>
          </section>
          <DeviceGroup
            title={t("authenticatorApps")}
            hint={t("authenticatorAppsHint")}
            icon={<Smartphone size={16} />}
            devices={devices.filter((d) => d.kind === "totp")}
            addLabel={t("addAuthenticatorApp")}
            kind="totp"
            onRemove={remove}
          />
          <DeviceGroup
            title={t("passkeys")}
            hint={t("passkeysHint")}
            icon={<Fingerprint size={16} />}
            devices={devices.filter((d) => d.kind === "webauthn")}
            addLabel={t("addPasskey")}
            kind="webauthn"
            onRemove={remove}
          />
          {devices.some((d) => d.kind === "other") && (
            <DeviceGroup
              title={t("otherAuthenticators")}
              hint={t("otherAuthenticatorsHint", { name: provider })}
              icon={<Key size={16} />}
              devices={devices.filter((d) => d.kind === "other")}
            />
          )}
          <p className="small muted">{t("setupHint", { name: provider })}</p>
        </>
      )}
      {removing && (
        <RemoveDeviceDialog
          device={removing}
          last={devices.filter((d) => d.kind !== "other").length === 1}
          onClose={() => setRemoving(null)}
          onRemoved={reload}
          onReauth={() => {
            setRemoving(null);
            setNeedReauth(true);
          }}
        />
      )}
    </>
  );
}

function DeviceGroup({
  title,
  hint,
  icon,
  devices,
  addLabel,
  kind,
  onRemove,
}: {
  title: string;
  hint: string;
  icon: ReactNode;
  devices: MfaDevice[];
  addLabel?: string;
  kind?: "totp" | "webauthn";
  onRemove?: (d: MfaDevice) => void;
}) {
  const { t, f } = useSettings();
  return (
    <section>
      <h3>{title}</h3>
      <p className="settings-hint mfa-group-hint">{hint}</p>
      {devices.length > 0 ? (
        <div className="settings-list">
          {devices.map((d) => (
            <div key={`${d.kind}:${d.id}`} className="settings-list-row">
              <span className="mfa-device-icon">{icon}</span>
              <div className="settings-list-main">
                <span>
                  {d.name || d.typeName}
                  {d.description && d.description !== d.name && <span className="muted small">{d.description}</span>}
                </span>
                <span className="small muted">
                  {d.created ? t("addedOn", { date: f.mediumDate(d.created) }) : d.typeName}
                  {" · "}
                  {d.lastUsed ? t("lastUsed", { when: f.relative(d.lastUsed, t) }) : t("neverUsed")}
                </span>
              </div>
              {onRemove && (
                <button className="text-button danger" onClick={() => onRemove(d)}>
                  {t("remove")}
                </button>
              )}
            </div>
          ))}
        </div>
      ) : (
        <p className="settings-empty">{t("noneYet")}</p>
      )}
      {kind && addLabel && (
        // A full page load: the setup happens on Authentik, which sends the user back here.
        <a className="text-button mfa-add" href={`/api/account/mfa/setup?kind=${kind}`}>
          <Plus size={14} />
          {addLabel}
        </a>
      )}
    </section>
  );
}

function RemoveDeviceDialog({
  device,
  last,
  onClose,
  onRemoved,
  onReauth,
}: {
  device: MfaDevice;
  last: boolean;
  onClose: () => void;
  onRemoved: () => void;
  onReauth: () => void;
}) {
  const { t } = useSettings();
  const { reloadMe } = useApp();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const name = device.name || device.typeName;
  return (
    <Dialog title={t("removeDeviceTitle", { name })} onClose={onClose}>
      <p className="dialog-text">
        {t("removeDeviceText")}
        {last && <> {t("removeLastDevice")}</>}
      </p>
      {error && <p className="error-text">{error}</p>}
      <div className="dialog-actions">
        <button className="text-button" onClick={onClose}>
          {t("cancel")}
        </button>
        <button
          className="primary-button danger"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError(null);
            try {
              await api(`/account/mfa/${device.kind}/${encodeURIComponent(device.id)}`, { method: "DELETE" });
              toast(t("deviceRemoved"));
              onRemoved();
              onClose();
            } catch (e) {
              // The recent sign-in ran out meanwhile.
              if (e instanceof ApiError && e.status === 403) {
                reloadMe();
                onReauth();
              } else {
                setError((e as Error).message);
                setBusy(false);
              }
            }
          }}
        >
          {t("remove")}
        </button>
      </div>
    </Dialog>
  );
}
