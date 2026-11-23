import { useCallback, useEffect, useMemo, useState } from "react";
import { api, type App as AppItem, type AppList, type AuthConfig, type Me, type ServerInfo } from "./lib/api";
import { AppContext, type AppContextValue, type SettingsPage } from "./lib/app";
import { MOBILE_QUERY, invalidate, useApi, useMediaQuery } from "./lib/hooks";
import { recordOpened, useFavorites } from "./lib/local";
import { useRouter } from "./lib/router";
import { SettingsProvider, useSettings } from "./lib/settings";
import { ToastProvider, useToast } from "./components/common";
import { Sidebar } from "./components/Sidebar";
import { AppsPage } from "./components/AppsPage";
import { DetailsPanel } from "./components/DetailsPanel";
import { AdminPage } from "./components/admin/AdminPage";
import { AdminPanel } from "./components/admin/AdminPanel";
import { SettingsDialog } from "./components/SettingsDialog";
import { SearchDialog } from "./components/SearchDialog";
import { usePrefsSync } from "./lib/prefs";

export default function App() {
  return (
    <SettingsProvider>
      <ToastProvider>
        <Root />
      </ToastProvider>
    </SettingsProvider>
  );
}

// Signing in at Authentik (or in another bayfield.dev app) doesn't give this app a session by itself:
// when signed out, check once with Authentik without showing anything (prompt=none). Not again in this
// tab for a while, unless coming from another site (such as Authentik right after signing in there),
// and not after signing out here, until signing in again.
const SILENT_TRIED = "apps:silent-signin";
const SIGNED_OUT = "apps:signed-out";
const SILENT_EVERY = 10 * 60_000;

function trySilentSignIn(): boolean {
  try {
    const q = new URLSearchParams(location.search);
    if (q.has("signin") || q.has("signin_error") || localStorage.getItem(SIGNED_OUT)) return false;
    const fromElsewhere = !!document.referrer && new URL(document.referrer).origin !== location.origin;
    if (!fromElsewhere && Date.now() - Number(sessionStorage.getItem(SILENT_TRIED) ?? 0) < SILENT_EVERY) return false;
    sessionStorage.setItem(SILENT_TRIED, String(Date.now()));
  } catch {
    return false; // Without storage there's no way to avoid trying on every load.
  }
  location.replace(`/api/auth/oidc/start?silent=1&next=${encodeURIComponent(location.pathname + location.search)}`);
  return true;
}

const rememberSignedOut = (out: boolean) => {
  try {
    if (out) localStorage.setItem(SIGNED_OUT, "1");
    else localStorage.removeItem(SIGNED_OUT);
  } catch {
    /* ignore */
  }
};

function Root() {
  const [me, setMe] = useState<Me | null | undefined>(undefined);

  const loadMe = useCallback(() => {
    api<Me>("/auth/me").then(
      (m) => {
        rememberSignedOut(false);
        setMe(m);
      },
      () => {
        if (!trySilentSignIn()) setMe(null);
      },
    );
  }, []);

  useEffect(loadMe, [loadMe]);

  // Any API call answering 401 means the session ended (expired, account deactivated).
  useEffect(() => {
    const onSignedOut = () => setMe(null);
    window.addEventListener("apps:signed-out", onSignedOut);
    return () => window.removeEventListener("apps:signed-out", onSignedOut);
  }, []);

  if (me === undefined) return <div className="splash" />;
  // Signed out still gets the hub: the public apps, and a way to sign in.
  return <Shell me={me} reloadMe={loadMe} onSignedOut={() => setMe(null)} />;
}

function Shell({ me, reloadMe, onSignedOut }: { me: Me | null; reloadMe: () => void; onSignedOut: () => void }) {
  const { settings, update } = useSettings();
  // Shared with the other bayfield.dev apps (prefs.bayfield.dev).
  usePrefsSync({ theme: settings.theme, customThemes: settings.customThemes, customTheme: settings.customTheme, language: settings.language }, update);
  const toast = useToast();
  const router = useRouter();
  const mobile = useMediaQuery(MOBILE_QUERY);
  const favorites = useFavorites();
  const [drawer, setDrawer] = useState(false);
  const [mobilePanel, setMobilePanel] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
  const [settingsPage, setSettingsPage] = useState<SettingsPage | null>(() => {
    const p = new URLSearchParams(location.search).get("settings");
    return p ? (p as SettingsPage) : null;
  });
  const auth = useApi<AuthConfig>("/auth/config").data;
  const server = useApi<ServerInfo>("/server").data;
  // Keyed by who is signed in, so signing in or out never shows the previous list.
  const appsPath = `/apps${me ? `?u=${encodeURIComponent(me.username)}` : ""}`;
  const appsReq = useApi<AppList>(appsPath);

  // Set by the server when sign-in fails (it redirects back with ?signin_error=…), and ?settings=… after confirming a sign-in.
  useEffect(() => {
    const q = new URLSearchParams(location.search);
    const error = q.get("signin_error");
    if (error) toast(error, "error");
    if (error || q.has("settings") || q.has("signin")) router.setQuery({ signin_error: undefined, settings: undefined, signin: undefined }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Close the drawers when navigating on phones.
  useEffect(() => {
    setDrawer(false);
  }, [router.route]);

  const apps = appsReq.data?.apps;
  const selected = router.query.app;
  const sidebarVisible = mobile ? drawer : settings.sidebar;
  const panelVisible = mobile ? mobilePanel : settings.panel;
  const toggleSidebar = () => (mobile ? setDrawer((d) => !d) : update({ sidebar: !settings.sidebar }));
  // Closing the panel also deselects the app it was showing.
  const closePanel = () => {
    if (mobile) setMobilePanel(false);
    else update({ panel: false });
    if (router.query.app || router.query.user) router.setQuery({ app: undefined, user: undefined }, true);
  };
  const openPanel = () => {
    if (mobile) setMobilePanel(true);
    else if (!settings.panel) update({ panel: true });
  };
  const togglePanel = () => {
    if (panelVisible) closePanel();
    else if (mobile) setMobilePanel(true);
    else update({ panel: true });
  };

  const targetOf = useCallback(
    (app: AppItem) => (settings.openIn === "new" || (settings.openIn === "app" && app.newTab) ? ("_blank" as const) : undefined),
    [settings.openIn],
  );

  const launch = useCallback(
    (app: AppItem) => {
      recordOpened(app.id);
      if (targetOf(app)) window.open(app.url, "_blank", "noopener");
      else location.href = app.url;
    },
    [targetOf],
  );

  const signIn = useCallback(() => {
    rememberSignedOut(false);
    if (auth?.oidc) location.href = `/api/auth/oidc/start?next=${encodeURIComponent(location.pathname + location.search)}`;
    else if (auth?.dev) {
      void api("/auth/dev-login", { method: "POST" }).then(() => {
        invalidate("/apps");
        reloadMe();
      });
    }
  }, [auth, reloadMe]);

  const value: AppContextValue = {
    me,
    reloadMe,
    auth,
    server,
    apps,
    appsError: appsReq.error,
    appsLoading: appsReq.loading,
    refreshApps: () => {
      void api<AppList>("/apps?refresh=1").then(
        () => {
          invalidate("/apps");
          appsReq.reload();
        },
        (e: Error) => toast(e.message, "error"),
      );
    },
    route: router.route,
    query: router.query,
    navigate: router.navigate,
    setQuery: router.setQuery,
    targetOf,
    launch,
    select: (id) => {
      router.setQuery({ app: id }, true);
      if (id) openPanel();
    },
    selectUser: (pk) => {
      router.setQuery({ user: pk === undefined ? undefined : String(pk) }, true);
      if (pk !== undefined) openPanel();
    },
    openSettings: (page) => setSettingsPage(page ?? (me ? "account" : "preferences")),
    signIn,
    signOut: () => {
      // The Authentik session outlives this one: don't sign straight back in silently.
      rememberSignedOut(true);
      void api("/auth/logout", { method: "POST" }).finally(() => {
        invalidate();
        setSettingsPage(null);
        onSignedOut();
      });
    },
    sidebarVisible,
    toggleSidebar,
    panelVisible,
    togglePanel,
    openSearch: () => setSearchOpen(true),
  };

  // Favorites 1–9, in starred order, among the apps this user can see.
  const favoriteApps = useMemo(
    () => favorites.ids.map((id) => apps?.find((a) => a.id === id)).filter((a): a is AppItem => !!a),
    [favorites.ids, apps],
  );

  // The admin pages are for Authentik superusers only (the server checks too).
  const isAdminRoute = router.route.name === "admin";
  useEffect(() => {
    if (isAdminRoute && !me?.isSuperuser) router.navigate({ name: "home" }, {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isAdminRoute, me]);

  // A selected app that isn't in the list any more (signed out, access removed).
  useEffect(() => {
    if (selected && apps && !apps.some((a) => a.id === selected)) router.setQuery({ app: undefined }, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected, apps]);

  // The same keys as Calendar, Notes and DevTime.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      const inField = !!target.closest?.("input, textarea, select, [contenteditable]");
      const ctrl = e.ctrlKey || e.metaKey;
      const k = e.key.toLowerCase();

      if (ctrl && !e.altKey && !e.shiftKey && (k === "b" || k === "\\")) {
        e.preventDefault();
        toggleSidebar();
        return;
      }
      if (ctrl && !e.altKey && k === "k") {
        e.preventDefault();
        setSearchOpen(true);
        return;
      }
      if (ctrl && !e.altKey && e.key === ",") {
        e.preventDefault();
        setSettingsPage((p) => p ?? (me ? "account" : "preferences"));
        return;
      }
      if (ctrl && !e.altKey && k === ".") {
        e.preventDefault();
        togglePanel();
        return;
      }

      // Single keys: not while typing, in a dialog, or with modifiers.
      if (ctrl || e.altKey || inField || settingsPage || searchOpen) return;
      if (document.querySelector(".dialog-backdrop, .picker")) return;

      if (k === "\\") toggleSidebar();
      else if (k === "/") setSearchOpen(true);
      else if (k === ".") togglePanel();
      else if (k === "escape" && mobile && (drawer || mobilePanel)) {
        setDrawer(false);
        if (mobilePanel) closePanel();
      } else if (k === "escape" && (selected || router.query.user)) router.setQuery({ app: undefined, user: undefined }, true);
      else if (/^[1-9]$/.test(k) && favoriteApps[Number(k) - 1]) launch(favoriteApps[Number(k) - 1]);
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  return (
    <AppContext.Provider value={value}>
      <div className="app">
        {sidebarVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={() => setDrawer(false)} />}
            <Sidebar favorites={favoriteApps} />
          </>
        )}
        <main className="main">
          {isAdminRoute && me?.isSuperuser ? <AdminPage /> : <AppsPage favorites={favoriteApps} />}
        </main>
        {panelVisible && (
          <>
            {mobile && <div className="sidebar-backdrop" onClick={closePanel} />}
            {isAdminRoute && me?.isSuperuser ? <AdminPanel /> : <DetailsPanel />}
          </>
        )}
      </div>
      {searchOpen && <SearchDialog onClose={() => setSearchOpen(false)} />}
      {settingsPage && <SettingsDialog page={settingsPage} onClose={() => setSettingsPage(null)} />}
    </AppContext.Provider>
  );
}
