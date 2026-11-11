"use client";

import { useEffect, useRef, type ReactNode } from "react";

export type FloatingIcon =
  | "overview"
  | "live"
  | "orders"
  | "menu"
  | "sales"
  | "settlements"
  | "finance"
  | "business"
  | "control"
  | "all"
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "delivered";

export type FloatingItem = {
  value: string;
  label: string;
  icon: FloatingIcon;
  badge?: string | number | null;
};

export function FloatingDock({ children }: { children: ReactNode }) {
  return <div className="floating-dock">{children}</div>;
}

export function FloatingNav({
  items,
  value,
  onChange,
  label
}: {
  items: FloatingItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const selected = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selected.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [value]);

  return <nav className="floating-bar dark" aria-label={label}>
    {items.map((item) => {
      const active = item.value === value;
      return <button
        key={item.value}
        ref={active ? selected : null}
        type="button"
        className={active ? "floating-item active" : "floating-item"}
        aria-current={active ? "page" : undefined}
        onClick={() => onChange(item.value)}
      >
        <span className="floating-icon">
          <FloatingGlyph name={item.icon} />
          {item.badge ? <span className="floating-badge">{item.badge}</span> : null}
        </span>
        <span className="floating-text">{item.label}</span>
      </button>;
    })}
  </nav>;
}

export function FloatingCategoryBar({
  items,
  value,
  onChange,
  label
}: {
  items: FloatingItem[];
  value: string;
  onChange: (value: string) => void;
  label: string;
}) {
  const selected = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    selected.current?.scrollIntoView({ behavior: "smooth", block: "nearest", inline: "center" });
  }, [value]);

  return <div className="floating-bar light" role="toolbar" aria-label={label}>
    {items.map((item) => {
      const active = item.value === value;
      return <button
        key={item.value || "all"}
        ref={active ? selected : null}
        type="button"
        className={active ? "floating-item active" : "floating-item"}
        aria-pressed={active}
        onClick={() => onChange(item.value)}
      >
        <span className="floating-icon">
          <FloatingGlyph name={item.icon} />
          {item.badge ? <span className="floating-badge">{item.badge}</span> : null}
        </span>
        <span className="floating-text">{item.label}</span>
      </button>;
    })}
  </div>;
}

function FloatingGlyph({ name }: { name: FloatingIcon }) {
  const common = {
    width: 18,
    height: 18,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
    "aria-hidden": true
  };
  switch (name) {
    case "overview":
      return <svg {...common}><rect x="3" y="3" width="7" height="7" rx="1.5" /><rect x="14" y="3" width="7" height="7" rx="1.5" /><rect x="3" y="14" width="7" height="7" rx="1.5" /><rect x="14" y="14" width="7" height="7" rx="1.5" /></svg>;
    case "live":
      return <svg {...common}><circle cx="12" cy="12" r="8" /><circle cx="12" cy="12" r="2" /><path d="M12 4v2M20 12h-2M12 20v-2M4 12h2" /></svg>;
    case "orders":
      return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
    case "menu":
      return <svg {...common}><path d="M4 5.5A2.5 2.5 0 0 1 6.5 3H20v18H6.5A2.5 2.5 0 0 1 4 18.5z" /><path d="M4 18.5A2.5 2.5 0 0 1 6.5 16H20" /></svg>;
    case "sales":
      return <svg {...common}><path d="M4 20v-7M10 20V8M16 20v-4M22 20H2" /></svg>;
    case "settlements":
      return <svg {...common}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18" /><path d="M16 15h2" /></svg>;
    case "finance":
      return <svg {...common}><path d="M4 20V10M10 20V4M16 20v-7M22 20H2" /></svg>;
    case "business":
      return <svg {...common}><path d="M4 10v10h16V10" /><path d="M3 10l2-6h14l2 6" /><path d="M8 20v-6h8v6" /></svg>;
    case "control":
      return <svg {...common}><circle cx="9" cy="8" r="3" /><path d="M3 20c.7-3.2 2.7-5 6-5s5.3 1.8 6 5" /><path d="M16 5h5M18.5 3v4M16 12h5M18.5 10v4" /></svg>;
    case "all":
      return <svg {...common}><path d="m12 3 9 5-9 5-9-5 9-5Z" /><path d="m3 13 9 5 9-5" /></svg>;
    case "new":
      return <svg {...common}><path d="M12 3v18M3 12h18" /></svg>;
    case "accepted":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m8 12 3 3 5-6" /></svg>;
    case "preparing":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "ready":
      return <svg {...common}><path d="M6 9a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6" /><path d="M10 19a2 2 0 0 0 4 0" /></svg>;
    case "delivered":
      return <svg {...common}><path d="m12 3 8 4v10l-8 4-8-4V7l8-4Z" /><path d="m4 7 8 4 8-4M12 11v10" /></svg>;
  }
}
