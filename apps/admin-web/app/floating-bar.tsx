"use client";

import { useEffect, useRef, type ReactNode } from "react";

export type FloatingIcon =
  | "overview"
  | "orders"
  | "merchants"
  | "couriers"
  | "users"
  | "settlements"
  | "batches"
  | "cod"
  | "subscriptions"
  | "ledger"
  | "reconciliation"
  | "config"
  | "audit"
  | "all"
  | "new"
  | "accepted"
  | "preparing"
  | "ready"
  | "delivered"
  | "cancelled"
  | "pending"
  | "approved"
  | "paid"
  | "failed";

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
    case "orders":
      return <svg {...common}><rect x="5" y="3" width="14" height="18" rx="2" /><path d="M9 8h6M9 12h6M9 16h4" /></svg>;
    case "merchants":
      return <svg {...common}><path d="M4 10h16v10H4z" /><path d="M3 5h18l-1.5 5H4.5L3 5Z" /><path d="M9 20v-5h6v5" /></svg>;
    case "couriers":
      return <svg {...common}><circle cx="6" cy="17" r="3" /><circle cx="18" cy="17" r="3" /><path d="M9 17h6l-2-7H8m5 0 2 7M5 9h4" /></svg>;
    case "users":
      return <svg {...common}><circle cx="9" cy="8" r="3.2" /><path d="M3.5 20a5.5 5.5 0 0 1 11 0" /><path d="M16 5a3 3 0 0 1 0 6M17.5 20a5.3 5.3 0 0 0-2-4.2" /></svg>;
    case "settlements":
      return <svg {...common}><rect x="3" y="6" width="18" height="13" rx="2.5" /><path d="M3 10h18M16 15h2" /></svg>;
    case "batches":
      return <svg {...common}><path d="m12 3 8 4-8 4-8-4 8-4Z" /><path d="m4 12 8 4 8-4M4 17l8 4 8-4" /></svg>;
    case "cod":
      return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><circle cx="12" cy="12" r="2.5" /><path d="M6 12h.01M18 12h.01" /></svg>;
    case "subscriptions":
      return <svg {...common}><path d="M20 8a8 8 0 0 0-14-2M4 16a8 8 0 0 0 14 2" /><path d="M20 4v4h-4M4 20v-4h4" /></svg>;
    case "ledger":
      return <svg {...common}><path d="M5 3h14v18H5z" /><path d="M9 7h6M9 11h6M9 15h4" /></svg>;
    case "reconciliation":
      return <svg {...common}><path d="M4 7h11M4 7l3-3M4 7l3 3M20 17H9M20 17l-3-3M20 17l-3 3" /></svg>;
    case "config":
      return <svg {...common}><path d="M4 7h10M18 7h2M4 17h2M10 17h10" /><circle cx="16" cy="7" r="2" /><circle cx="8" cy="17" r="2" /></svg>;
    case "audit":
      return <svg {...common}><path d="M5 3h14v18H5z" /><path d="M8 8h8M8 12h8M8 16h5" /></svg>;
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
    case "cancelled":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="m9 9 6 6M15 9l-6 6" /></svg>;
    case "pending":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 7v5l3 2" /></svg>;
    case "approved":
      return <svg {...common}><path d="m4 12 5 5L20 6" /></svg>;
    case "paid":
      return <svg {...common}><rect x="3" y="6" width="18" height="12" rx="2" /><path d="m7 12 3 3 7-7" /></svg>;
    case "failed":
      return <svg {...common}><circle cx="12" cy="12" r="9" /><path d="M12 8v5M12 16h.01" /></svg>;
  }
}
