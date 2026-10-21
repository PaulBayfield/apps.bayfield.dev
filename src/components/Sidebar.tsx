import { useMemo, useRef, type CSSProperties } from "react";
import type { App } from "../lib/api";
import { byCategory, useApp } from "../lib/app";
import { recordOpened, useRecent } from "../lib/local";
import { useSettings } from "../lib/settings";
import { AppIcon } from "./AppIcon";
import { Clock, Folder, Gear, LayoutGrid, PanelLeft, Search } from "./icons";

const MIN_W = 200;
const MAX_W = 480;
const DEFAULT_W = 248;

/** Same layout as Calendar's, Notes' and DevTime's sidebars: toggle and search on top, then the pages. */
export function Sidebar({ favorites }: { favorites: App[] }) {
  const { t, settings } = useSettings();
  const { route, navigate, apps, toggleSidebar, openSearch, openSettings, targetOf, me } = useApp();
  const recent = useRecent();
  const categories = useMemo(() => byCategory(apps ?? []).filter(([c]) => c), [apps]);
  const recentCount = recent.entries.filter((e) => apps?.some((a) => a.id === e.id)).length;

  return (
    <aside className="sidebar" style={{ "--sidebar-w": `${settings.sidebarWidth}px` } as CSSProperties}>
      <ResizeHandle />
      <div className="sidebar-top">
        <button className="icon-button" title={`${t("toggleSidebar")} (Ctrl+B)`} aria-label={t("toggleSidebar")} onClick={toggleSidebar}>
          <PanelLeft />
        </button>
        <div className="toolbar-spacer" />
        <button className="icon-button" title={`${t("search")} (Ctrl+K)`} aria-label={t("search")} onClick={openSearch}>
          <Search />
        </button>
      </div>

      <nav className="sidebar-nav">
        <button className={`sidebar-row${route.name === "home" ? " active" : ""}`} onClick={() => navigate({ name: "home" })}>
          <LayoutGrid />
          <span className="row-label">{t("home")}</span>
          {apps && <span className="row-meta">{apps.length}</span>}
        </button>
        <button className={`sidebar-row${route.name === "recent" ? " active" : ""}`} onClick={() => navigate({ name: "recent" })}>
          <Clock />
          <span className="row-label">{t("recent")}</span>
          {recentCount > 0 && <span className="row-meta">{recentCount}</span>}
        </button>
      </nav>

      {/* Only the lists scroll; the header and pages stay put. */}
      <div className="sidebar-scroll">
        {favorites.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t("favorites")}</div>
            {favorites.map((app, i) => (
              <a
                key={app.id}
                className="sidebar-row"
                href={app.url}
                target={targetOf(app)}
                rel="noopener noreferrer"
                title={app.name}
                onClick={() => recordOpened(app.id)}
                onAuxClick={(e) => e.button === 1 && recordOpened(app.id)}
              >
                <AppIcon app={app} size={18} />
                <span className="row-label">{app.name}</span>
                {i < 9 && <kbd className="row-kbd">{i + 1}</kbd>}
              </a>
            ))}
          </div>
        )}
        {categories.length > 0 && (
          <div className="sidebar-group">
            <div className="sidebar-group-title">{t("categories")}</div>
            {categories.map(([category, list]) => (
              <button
                key={category}
                className={`sidebar-row${route.name === "category" && route.category === category ? " active" : ""}`}
                onClick={() => navigate({ name: "category", category })}
                title={category}
              >
                <Folder />
                <span className="row-label">{category}</span>
                <span className="row-meta">{list.length}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* As in Notes. */}
      <nav className="sidebar-footer">
        <button className="sidebar-row" onClick={() => openSettings(me ? "account" : "preferences")}>
          <Gear size={15} />
          <span className="row-label">{t("settings")}</span>
          <span className="keys">
            <kbd>Ctrl</kbd>
            <kbd>,</kbd>
          </span>
        </button>
      </nav>
    </aside>
  );
}

/** Drag the right edge to resize; double-click to reset. */
function ResizeHandle() {
  const { update } = useSettings();
  const drag = useRef<{ x: number; w: number; aside: HTMLElement } | null>(null);
  const clamp = (w: number) => Math.round(Math.min(MAX_W, Math.max(MIN_W, w)));
  return (
    <div
      className="sidebar-resize"
      role="separator"
      aria-orientation="vertical"
      onPointerDown={(e) => {
        if (e.button !== 0) return;
        const aside = e.currentTarget.parentElement!;
        drag.current = { x: e.clientX, w: aside.getBoundingClientRect().width, aside };
        e.currentTarget.setPointerCapture(e.pointerId);
        document.documentElement.classList.add("resizing-sidebar");
        e.preventDefault();
      }}
      onPointerMove={(e) => {
        const d = drag.current;
        if (d) d.aside.style.setProperty("--sidebar-w", `${clamp(d.w + e.clientX - d.x)}px`);
      }}
      onPointerUp={(e) => {
        const d = drag.current;
        if (!d) return;
        drag.current = null;
        document.documentElement.classList.remove("resizing-sidebar");
        update({ sidebarWidth: clamp(d.w + e.clientX - d.x) });
      }}
      onDoubleClick={() => update({ sidebarWidth: DEFAULT_W })}
    />
  );
}
