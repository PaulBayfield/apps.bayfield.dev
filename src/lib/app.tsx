// What every page can reach: the user (or null when signed out), the apps, navigation, settings.

import { createContext, useContext } from "react";
import type { App, AuthConfig, Me, ServerInfo } from "./api";
import type { Route } from "./router";

export type SettingsPage = "account" | "password" | "security" | "preferences" | "shortcuts" | "about";

export interface AppContextValue {
  /** null: signed out (public apps only). */
  me: Me | null;
  reloadMe: () => void;
  auth: AuthConfig | undefined;
  server: ServerInfo | undefined;
  apps: App[] | undefined;
  appsError: string | null;
  appsLoading: boolean;
  /** Asks Authentik again, skipping the server's minute-long cache. */
  refreshApps: () => void;
  route: Route;
  query: Record<string, string>;
  navigate: (route: Route, query?: Record<string, string>) => void;
  setQuery: (patch: Record<string, string | undefined>, replace?: boolean) => void;
  /** "_blank" when the app should open in a new tab (the preference, else the app's own setting). */
  targetOf: (app: App) => "_blank" | undefined;
  /** Opens an app from code (keyboard, search), like clicking its card. */
  launch: (app: App) => void;
  /** Shows an app in the details panel. */
  select: (id: string | undefined) => void;
  openSettings: (page?: SettingsPage) => void;
  signIn: () => void;
  signOut: () => void;
  sidebarVisible: boolean;
  toggleSidebar: () => void;
  panelVisible: boolean;
  togglePanel: () => void;
  openSearch: () => void;
}

export const AppContext = createContext<AppContextValue | null>(null);

export function useApp(): AppContextValue {
  const v = useContext(AppContext);
  if (!v) throw new Error("useApp outside the app");
  return v;
}

/** Apps grouped by category (Authentik's application group), named groups first, then "Other". */
export function byCategory<T extends { category: string; name: string }>(apps: T[]): [string, T[]][] {
  const groups = new Map<string, T[]>();
  for (const a of apps) groups.set(a.category, [...(groups.get(a.category) ?? []), a]);
  return [...groups.entries()].sort(([a], [b]) => (!a ? 1 : !b ? -1 : a.localeCompare(b)));
}
