// A floating layer (menus), the same as Calendar's. Portalled to <body> so a menu's or dialog's overflow can't clip it.

import { useEffect, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

const GAP = 4;
const MARGIN = 8;

/** Floating layer under (or above) `anchor`; closes on outside click and Esc. */
export function Dropdown({ anchor, onClose, children, className = "" }: {
  anchor: RefObject<HTMLElement | null>;
  onClose: () => void;
  children: ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);

  useLayoutEffect(() => {
    const a = anchor.current?.getBoundingClientRect();
    const el = ref.current;
    if (!a || !el) return;
    const below = a.bottom + GAP + el.offsetHeight <= window.innerHeight - MARGIN;
    setPos({
      left: Math.min(Math.max(MARGIN, a.right - el.offsetWidth), window.innerWidth - el.offsetWidth - MARGIN),
      top: below ? a.bottom + GAP : Math.max(MARGIN, a.top - GAP - el.offsetHeight),
    });
  }, [anchor]);

  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      const target = e.target as Node;
      if (!ref.current?.contains(target) && !anchor.current?.contains(target)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onClose();
    };
    const onScroll = (e: Event) => !ref.current?.contains(e.target as Node) && onClose();
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey, true);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey, true);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [anchor, onClose]);

  return createPortal(
    <div ref={ref} className={`picker ${className}`} style={pos ?? { left: -9999, top: 0, visibility: "hidden" }}>
      {children}
    </div>,
    document.body,
  );
}
