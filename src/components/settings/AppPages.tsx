import { useApp } from "../../lib/app";
import { useSettings, type Settings, type Theme } from "../../lib/settings";
import type { StringKey } from "../../lib/i18n";
import type { UpdateCheck } from "../../lib/updates";
import { ExternalLink } from "../icons";
import { PageHeader, Row, Switch } from "./common";
import { connectPrefs, disconnectPrefs, usePrefsStatus, activeCustomTheme, BASE_COLORS, PREFS_URL } from "../../lib/prefs";

// --- Preferences ---

const THEMES: { id: Theme; label: StringKey }[] = [
  { id: "system", label: "themeSystem" },
  { id: "light", label: "themeLight" },
  { id: "dark", label: "themeDark" },
  { id: "rosepine", label: "themeRosepine" },
  { id: "rosepine-dawn", label: "themeRosepineDawn" },
];

export function PreferencesPage() {
  const { t, settings, update } = useSettings();
  const select = <K extends keyof Settings>(key: K, options: [Settings[K], string][]) => (
    <select
      value={String(settings[key])}
      onChange={(e) => update({ [key]: options.find(([v]) => String(v) === e.target.value)![0] } as Partial<Settings>)}
    >
      {options.map(([value, label]) => (
        <option key={String(value)} value={String(value)}>
          {label}
        </option>
      ))}
    </select>
  );

  return (
    <>
      <PageHeader title={t("preferences")} hint={t("preferencesHint")} />
      <section>
        <h3>{t("appearance")}</h3>
        <div className="theme-picker">
          {THEMES.map(({ id, label }) => (
            <button key={id} className={`theme-card${!activeCustomTheme(settings) && settings.theme === id ? " active" : ""}`} onClick={() => update({ theme: id, customTheme: "" })}>
              <span className={`theme-preview ${id}`}>
                <span />
                <span />
                <span />
              </span>
              <span className="theme-card-name">{t(label)}</span>
            </button>
          ))}
          {settings.customThemes.map((theme) => {
            const c = { ...BASE_COLORS[theme.base], ...theme.colors };
            return (
              <button
                key={theme.id}
                className={`theme-card${activeCustomTheme(settings)?.id === theme.id ? " active" : ""}`}
                title={theme.name}
                onClick={() => update({ theme: theme.base, customTheme: theme.id })}
              >
                <span className="theme-preview" style={{ background: c.bg, borderColor: c["border-strong"] }}>
                  <span style={{ background: c["bg-sidebar"] }} />
                  <span style={{ background: c.primary }} />
                  <span style={{ background: c.accent }} />
                </span>
                <span className="theme-card-name">{theme.name}</span>
              </button>
            );
          })}
        </div>
        <p className="theme-manage">
          {t("manageThemesHint")}{" "}
          <a className="theme-manage-link" href={PREFS_URL} target="_blank" rel="noopener">
            {t("manageThemes")}
            <ExternalLink size={13} />
          </a>
        </p>
      </section>
      <section className="settings-rows">
        <Row label={t("languageLabel")}>
          {select("language", [
            ["auto", t("automatic")],
            ["fr", "Français"],
            ["en", "English"],
          ])}
        </Row>
        <Row label={t("openApps")} hint={t("openAppsHint")}>
          {select("openIn", [
            ["app", t("openAsSet")],
            ["new", t("openNewTab")],
            ["same", t("openSameTab")],
          ])}
        </Row>
        <Row label={t("showDescriptions")} hint={t("showDescriptionsHint")}>
          <Switch checked={settings.descriptions} onChange={(on) => update({ descriptions: on })} label={t("showDescriptions")} />
        </Row>
      </section>
      <PrefsSyncRow />
    </>
  );
}

// --- About ---

const REPO_URL = "https://github.com/PaulBayfield/apps.bayfield.dev";

/** The version, whether a newer one is out, and where to find the source. */
export function AboutPage({ updates }: { updates: UpdateCheck }) {
  const { t, f } = useSettings();
  const { server } = useApp();
  const { status, checking, error, check } = updates;
  const version = status?.current ?? (server?.version && server.version !== "dev" ? server.version : __APP_VERSION__);
  const latest = status?.available ? status.latest : null;

  const hint = status?.disabled
    ? t("updateCheckOff")
    : checking
      ? t("checkingUpdates")
      : latest
        ? t("updateAvailable", { version: latest.version })
        : error
          ? t("updateCheckFailed")
          : status?.latest
            ? t("upToDate")
            : t("noReleases");

  return (
    <>
      <PageHeader title={t("about")} />
      <section className="settings-rows">
        <Row label={t("appName")} hint={t("aboutText")}>
          <span className="muted small tabular">{t("version", { version })}</span>
        </Row>
        <Row
          label={t("updates")}
          hint={
            <>
              {hint}
              {latest && <> {t("updateHowTo")}</>}
              {!latest && status?.checkedAt && !checking && !status.disabled && <> · {t("lastChecked", { when: f.relative(status.checkedAt, t) })}</>}
            </>
          }
        >
          {latest ? (
            <a className="primary-button" href={latest.url} target="_blank" rel="noreferrer">
              {t("whatsNew")}
            </a>
          ) : (
            !status?.disabled && (
              <button className="text-button" disabled={checking} onClick={() => void check()}>
                {t("checkForUpdates")}
              </button>
            )
          )}
        </Row>
        <Row label={t("allVersions")}>
          <a className="text-button" href={status?.releasesUrl ?? `${REPO_URL}/releases`} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            {t("releaseNotes")}
          </a>
        </Row>
        <Row label={t("sourceCode")}>
          <a className="text-button" href={REPO_URL} target="_blank" rel="noreferrer">
            <ExternalLink size={14} />
            GitHub
          </a>
        </Row>
      </section>
    </>
  );
}

/** Theme and language shared with the other bayfield.dev apps, through prefs.bayfield.dev. */
function PrefsSyncRow() {
  const { t } = useSettings();
  const { status, email } = usePrefsStatus();
  const hint =
    status === "connected"
      ? t("prefsConnected", { email: email ?? "" })
      : status === "connecting"
        ? t("prefsApprove")
        : status === "offline"
          ? t("prefsOffline")
          : t("prefsHint");
  return (
    <section className="settings-rows">
      <h3>{t("prefsTitle")}</h3>
      <Row label={t("prefsLabel")} hint={hint}>
        {status === "connected" ? (
          <button className="text-button" onClick={() => void disconnectPrefs()}>
            {t("prefsDisconnect")}
          </button>
        ) : status === "disconnected" || status === "connecting" ? (
          <button className="primary-button" onClick={() => void connectPrefs("Apps")}>
            {t("prefsConnect")}
          </button>
        ) : null}
      </Row>
    </section>
  );
}
