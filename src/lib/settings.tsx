// Device preferences (theme, language, layout, how apps open), kept in localStorage.

import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { makeFormats, makeT, resolveLang, type Formats, type Lang, type Translate } from "./i18n";
import { activeCustomTheme, themeVars, type CustomTheme } from "./prefs";

export type Theme = "system" | "light" | "dark" | "rosepine" | "rosepine-dawn";

export interface Settings {
  theme: Theme;
  /** Custom themes, made on prefs.bayfield.dev and synced from there. */
  customThemes: CustomTheme[];
  /** The custom theme in use (its id), laid over `theme`; "" for none. */
  customTheme: string;
  language: "auto" | Lang;
  /** "app": each app's own setting (Authentik's "open in new tab"). */
  openIn: "app" | "new" | "same";
  descriptions: boolean;
  sidebar: boolean;
  sidebarWidth: number;
  /** The details panel on the right. */
  panel: boolean;
}

const STORAGE_KEY = "apps.settings";
/** The custom theme's CSS variables, for index.html to set before the app loads (no flash). */
const THEME_VARS_KEY = "apps.themeVars";

const DEFAULTS: Settings = {
  theme: "system",
  customThemes: [],
  customTheme: "",
  language: "auto",
  openIn: "app",
  descriptions: true,
  sidebar: true,
  sidebarWidth: 248,
  panel: false,
};

function load(): Settings {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") };
  } catch {
    return DEFAULTS;
  }
}

function save(settings: Settings) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Not critical.
  }
}

interface SettingsContextValue {
  settings: Settings;
  update: (patch: Partial<Settings>) => void;
  t: Translate;
  f: Formats;
  lang: Lang;
  /** The theme in effect ("system" resolved). */
  dark: boolean;
}

const SettingsContext = createContext<SettingsContextValue | null>(null);

const darkQuery = window.matchMedia("(prefers-color-scheme: dark)");

export function SettingsProvider({ children }: { children: ReactNode }) {
  const [settings, setSettings] = useState(load);
  const [systemDark, setSystemDark] = useState(darkQuery.matches);

  useEffect(() => {
    const onChange = () => setSystemDark(darkQuery.matches);
    darkQuery.addEventListener("change", onChange);
    return () => darkQuery.removeEventListener("change", onChange);
  }, []);

  const resolvedTheme = settings.theme === "system" ? (systemDark ? "dark" : "light") : settings.theme;
  const dark = resolvedTheme === "dark" || resolvedTheme === "rosepine";
  useEffect(() => {
    document.documentElement.dataset.theme = resolvedTheme;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg || "#ffffff");
  }, [resolvedTheme]);

  // A custom theme (made on prefs.bayfield.dev): its colours over its base theme.
  const customKey = JSON.stringify(activeCustomTheme(settings));
  const customVars = useMemo(() => {
    const custom = JSON.parse(customKey) as CustomTheme | null;
    if (!custom) return {};
    const vars = themeVars(custom);
    return vars;
  }, [customKey]);
  useEffect(() => {
    const root = document.documentElement.style;
    try {
      // What index.html set from the last session, if this theme no longer sets it.
      for (const k of Object.keys(JSON.parse(localStorage.getItem(THEME_VARS_KEY) ?? "{}") as object)) if (!(k in customVars)) root.removeProperty(k);
    } catch {
      // Nothing was set then.
    }
    for (const [k, v] of Object.entries(customVars)) root.setProperty(k, v);
    try {
      if (Object.keys(customVars).length) localStorage.setItem(THEME_VARS_KEY, JSON.stringify(customVars));
      else localStorage.removeItem(THEME_VARS_KEY);
    } catch {
      // Only the first paint uses it.
    }
    // The installed app's title bar follows the background.
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute("content", bg);
    return () => {
      for (const k of Object.keys(customVars)) root.removeProperty(k);
    };
  }, [customVars]);

  const value = useMemo<SettingsContextValue>(() => {
    const lang = resolveLang(settings.language);
    document.documentElement.lang = lang;
    return {
      settings,
      update: (patch) =>
        setSettings((s) => {
          const next = { ...s, ...patch };
          save(next);
          return next;
        }),
      t: makeT(lang),
      f: makeFormats(lang),
      lang,
      dark,
    };
  }, [settings, dark]);

  return <SettingsContext.Provider value={value}>{children}</SettingsContext.Provider>;
}

export function useSettings(): SettingsContextValue {
  const value = useContext(SettingsContext);
  if (!value) throw new Error("useSettings outside SettingsProvider");
  return value;
}
