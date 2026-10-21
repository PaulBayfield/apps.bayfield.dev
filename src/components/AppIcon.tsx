import { useState, type CSSProperties } from "react";
import type { App } from "../lib/api";
import { useSettings } from "../lib/settings";

// DevTime's categorical palette (validated for colour-vision deficiency on all four themes).
const LIGHT = ["#2a78d6", "#eb6834", "#1baf7a", "#eda100", "#e87ba4", "#008300", "#6250d6", "#e34948"];
const DARK = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181", "#008300", "#9085e9", "#e66767"];

function hash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
  return Math.abs(h);
}

/** The app's icon, or its first letter on a colour picked from its name when it has none (or it fails to load). */
export function AppIcon({ app, size = 40 }: { app: Pick<App, "name" | "icon">; size?: number }) {
  const { dark } = useSettings();
  const [broken, setBroken] = useState<string | null>(null);
  const style = { "--size": `${size}px` } as CSSProperties;
  if (app.icon && broken !== app.icon) {
    return (
      <span className="app-icon image" style={style}>
        <img src={app.icon} alt="" loading="lazy" referrerPolicy="no-referrer" onError={() => setBroken(app.icon)} />
      </span>
    );
  }
  const palette = dark ? DARK : LIGHT;
  return (
    <span className="app-icon letter" style={{ ...style, "--c": palette[hash(app.name) % palette.length] } as CSSProperties} aria-hidden="true">
      {(app.name.trim()[0] ?? "?").toUpperCase()}
    </span>
  );
}
