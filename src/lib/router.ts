// Address-bar routing: the path picks the page, the query string holds the filters and the
// selected app, so every view can be bookmarked and shared.

import { useCallback, useEffect, useState } from "react";

export type Route = { name: "home" } | { name: "recent" } | { name: "category"; category: string };

export function parseRoute(path: string): Route {
  const parts = path.replace(/^\/+|\/+$/g, "").split("/").map(decodeURIComponent);
  if (parts[0] === "recent") return { name: "recent" };
  if (parts[0] === "c" && parts[1] !== undefined) return { name: "category", category: parts.slice(1).join("/") };
  return { name: "home" };
}

export function routePath(r: Route): string {
  switch (r.name) {
    case "recent":
      return "/recent";
    case "category":
      return `/c/${encodeURIComponent(r.category)}`;
    default:
      return "/";
  }
}

export const sameRoute = (a: Route, b: Route) => routePath(a) === routePath(b);

const readQuery = () => Object.fromEntries(new URLSearchParams(location.search));

export function useRouter() {
  const [state, setState] = useState(() => ({ route: parseRoute(location.pathname), query: readQuery() }));

  useEffect(() => {
    const onPop = () => setState({ route: parseRoute(location.pathname), query: readQuery() });
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  /** Goes to a page; the access filter and selected app carry over unless `query` says otherwise. */
  const navigate = useCallback((route: Route, query?: Record<string, string>) => {
    setState((s) => {
      const q = query ?? pick(s.query, ["access", "app"]);
      const search = new URLSearchParams(q).toString();
      history.pushState(null, "", routePath(route) + (search ? `?${search}` : ""));
      return { route, query: q };
    });
    document.querySelector(".content")?.scrollTo(0, 0);
  }, []);

  /** Changes the query string of the current page without a new history entry per keystroke. */
  const setQuery = useCallback((patch: Record<string, string | undefined>, replace = false) => {
    setState((s) => {
      const q = { ...s.query };
      for (const [k, v] of Object.entries(patch)) {
        if (v === undefined || v === "") delete q[k];
        else q[k] = v;
      }
      const search = new URLSearchParams(q).toString();
      history[replace ? "replaceState" : "pushState"](null, "", location.pathname + (search ? `?${search}` : ""));
      return { ...s, query: q };
    });
  }, []);

  return { route: state.route, query: state.query, navigate, setQuery };
}

function pick(q: Record<string, string>, keys: string[]) {
  return Object.fromEntries(Object.entries(q).filter(([k]) => keys.includes(k)));
}
