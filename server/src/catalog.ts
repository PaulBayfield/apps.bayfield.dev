// The list shown in the hub: the public apps from config/apps.json for everyone, plus, once signed
// in, the Authentik applications that user may open.

import { readFile, stat } from "node:fs/promises";
import { APPS_FILE } from "./config.ts";
import { appsFor, type AkApp } from "./authentik.ts";

export interface App {
  /** "public:<id>" or "authentik:<slug>": stable, for favourites and recents. */
  id: string;
  name: string;
  url: string;
  description: string;
  publisher: string;
  icon: string | null;
  category: string;
  access: "public" | "private";
  newTab: boolean;
}

interface PublicEntry {
  id?: string;
  name?: string;
  url?: string;
  description?: string;
  publisher?: string;
  icon?: string;
  category?: string;
  newTab?: boolean;
}

let cached: { mtime: number; apps: App[] } | null = null;

const slugify = (s: string) =>
  s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

/** Re-read whenever the file changes, so editing it needs no restart. A broken file keeps the last good list. */
export async function publicApps(): Promise<App[]> {
  let mtime: number;
  try {
    mtime = (await stat(APPS_FILE)).mtimeMs;
  } catch {
    return [];
  }
  if (cached?.mtime === mtime) return cached.apps;
  try {
    const raw = JSON.parse(await readFile(APPS_FILE, "utf8")) as { apps?: PublicEntry[] } | PublicEntry[];
    const entries = Array.isArray(raw) ? raw : (raw.apps ?? []);
    const seen = new Set<string>();
    const apps: App[] = [];
    for (const e of entries) {
      if (!e?.name || !e.url || !/^https?:\/\//.test(e.url)) {
        console.warn(`${APPS_FILE}: skipped an entry without a name or an http(s) url:`, e);
        continue;
      }
      let id = slugify(e.id ?? e.name) || "app";
      while (seen.has(id)) id += "-2";
      seen.add(id);
      apps.push({
        id: `public:${id}`,
        name: e.name,
        url: e.url,
        description: e.description ?? "",
        publisher: e.publisher ?? "",
        icon: e.icon && /^(https?:\/\/|\/)/.test(e.icon) ? e.icon : null,
        category: e.category ?? "",
        access: "public",
        newTab: !!e.newTab,
      });
    }
    cached = { mtime, apps };
  } catch (e) {
    console.warn(`Couldn't read ${APPS_FILE}:`, e);
    if (!cached) return [];
  }
  return cached!.apps;
}

const fromAuthentik = (a: AkApp): App => ({
  id: `authentik:${a.slug}`,
  name: a.name,
  url: a.url,
  description: a.description,
  publisher: a.publisher,
  icon: a.icon,
  category: a.group,
  access: "private",
  newTab: a.newTab,
});

const sameUrl = (a: string, b: string) => a.replace(/\/+$/, "").toLowerCase() === b.replace(/\/+$/, "").toLowerCase();

/** Everything `pk` can open (public first if both list the same URL), sorted by name. */
export async function catalog(pk: number | null, fresh = false): Promise<App[]> {
  const pub = await publicApps();
  if (pk === null) return pub;
  const priv = (await appsFor(pk, fresh)).map(fromAuthentik).filter((p) => !pub.some((a) => sameUrl(a.url, p.url)));
  return [...pub, ...priv].sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
}
