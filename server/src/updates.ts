// Whether a newer version of Apps is out, from the GitHub releases (same check as Calendar, Notes and DevTime).
// Done here rather than in the browser: the page's CSP only allows its own origin, and one
// cached lookup serves every user.

import { APP_VERSION } from "./config.ts";

const REPO = "PaulBayfield/apps.bayfield.dev";
export const RELEASES_URL = `https://github.com/${REPO}/releases`;
const CACHE_MS = 6 * 60 * 60_000;
/** After a failed lookup, wait a little before asking GitHub again. */
const RETRY_MS = 10 * 60_000;

export interface Release {
  version: string;
  /** The release page, with its notes. */
  url: string;
  publishedAt: string | null;
}

export interface UpdateStatus {
  current: string;
  latest: Release | null;
  available: boolean;
  releasesUrl: string;
  checkedAt: string;
  error?: string;
}

/** 1 if `a` is newer than `b`, -1 if older, 0 if the same ("v0.10.0" > "0.9.1"). */
export function compareVersions(a: string, b: string): number {
  const parts = (v: string) =>
    v
      .replace(/^v/, "")
      .split(/[.-]/)
      .map((x) => parseInt(x, 10) || 0);
  const pa = parts(a);
  const pb = parts(b);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d) return d > 0 ? 1 : -1;
  }
  return 0;
}

/** The latest published release (drafts and pre-releases don't count), or null if there is none yet. */
async function latestRelease(): Promise<Release | null> {
  const res = await fetch(`https://api.github.com/repos/${REPO}/releases/latest`, {
    headers: { accept: "application/vnd.github+json", "user-agent": `Apps/${APP_VERSION}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`GitHub answered ${res.status}`);
  const json = (await res.json()) as { tag_name: string; html_url: string; published_at?: string | null };
  return { version: json.tag_name.replace(/^v/, ""), url: json.html_url, publishedAt: json.published_at ?? null };
}

let cached: { status: UpdateStatus; until: number } | null = null;
let pending: Promise<UpdateStatus> | null = null;

/** Cached for a few hours; `force` asks GitHub again (the "Check for updates" button). */
export async function updateStatus(force = false): Promise<UpdateStatus> {
  if (!force && cached && cached.until > Date.now()) return cached.status;
  pending ??= (async () => {
    const base = { current: APP_VERSION, releasesUrl: RELEASES_URL, checkedAt: new Date().toISOString() };
    try {
      const latest = await latestRelease();
      const available = !!latest && APP_VERSION !== "dev" && compareVersions(latest.version, APP_VERSION) > 0;
      const status: UpdateStatus = { ...base, latest, available };
      cached = { status, until: Date.now() + CACHE_MS };
      return status;
    } catch (e) {
      // Keep showing a known update rather than replacing it with an error.
      const status: UpdateStatus = cached?.status.available ? cached.status : { ...base, latest: null, available: false, error: (e as Error).message };
      cached = { status, until: Date.now() + RETRY_MS };
      return status;
    } finally {
      pending = null;
    }
  })();
  return pending;
}
