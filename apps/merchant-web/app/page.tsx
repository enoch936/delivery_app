"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  api,
  apiRaw,
  loadSession,
  logout,
  money,
  requestOtp,
  saveSession,
  verifyOtp,
  type Session
} from "../lib/api";
import { FloatingCategoryBar, FloatingDock, FloatingNav, type FloatingItem } from "./floating-bar";
import { LiveMap } from "./live-map";

type Tab = "overview" | "live" | "orders" | "menu" | "sales" | "settlements" | "finance" | "business" | "control";

const NAV_ITEMS: FloatingItem[] = [
  { value: "overview", label: "Overview", icon: "overview" },
  { value: "live", label: "Live", icon: "live" },
  { value: "orders", label: "Orders", icon: "orders" },
  { value: "menu", label: "Menu", icon: "menu" },
  { value: "sales", label: "Sales", icon: "sales" },
  { value: "settlements", label: "Settlements", icon: "settlements" },
  { value: "finance", label: "Finance", icon: "finance" },
  { value: "business", label: "Business", icon: "business" },
  { value: "control", label: "Control", icon: "control" }
];

const ORDER_FILTERS: FloatingItem[] = [
  { value: "", label: "All", icon: "all" },
  { value: "PENDING_CONFIRMATION", label: "New", icon: "new" },
  { value: "ACCEPTED_BY_MERCHANT", label: "Accepted", icon: "accepted" },
  { value: "PREPARING", label: "Preparing", icon: "preparing" },
  { value: "READY_FOR_PICKUP", label: "Ready", icon: "ready" },
  { value: "DELIVERED", label: "Delivered", icon: "delivered" }
];

type MerchantLocation = {
  id: string; name: string; addressLine: string; latitude: number | null; longitude: number | null;
  openingHours: Record<string, unknown>; isActive: boolean;
};

type MerchantMe = {
  merchant: {
    id: string; slug: string; displayName: string; description: string | null; logoUrl: string | null;
    status: string; commissionBps: number; deliveryRadiusKm: number; cancellationPolicy: string | null;
    refundPolicy: string | null; minScheduleLeadMinutes: number; maxScheduleDays: number;
    rejectionReason: string | null; suspensionReason: string | null;
    supportsDelivery: boolean; supportsPickup: boolean; pickupInstructions: string | null;
    allowsScheduling: boolean; acceptingOrders: boolean; availabilityNote: string | null;
  };
  membership: { role: string; permissions: string[] };
  locations: MerchantLocation[];
  categories: Array<{ id: string; slug: string; display_name: string; sort_order: number }>;
  stats: { todayOrders: number; pendingOrders: number; revenueTodayMinor: number };
};

type MerchantMember = { userId: string; phoneE164: string; email: string | null; displayName: string | null; role: string; permissions: string[]; isActive: boolean; activeSessions: number; joinedAt: string };
type StaffInvitation = { id: string; phoneE164: string; role: string; permissions: string[]; expiresAt: string; invitedByName: string | null };
type FulfillmentSettings = {
  supportsDelivery: boolean; supportsPickup: boolean; allowsScheduling: boolean; pickupInstructions: string | null;
  minScheduleLeadMinutes: number; maxScheduleDays: number; acceptingOrders: boolean; availabilityNote: string | null;
};
type MerchantClosure = { id: string; locationId: string | null; locationName: string | null; startsAt: string; endsAt: string; reason: string | null; createdAt: string };
type NotificationPreferences = { pushEnabled: boolean; smsEnabled: boolean; emailEnabled: boolean; orderUpdates: boolean; promotions: boolean; securityAlerts: boolean };
type SupportTicket = { id: string; subject: string; category: string; status: string; priority: string; orderNumber: string | null; messageCount: number; createdAt: string; updatedAt: string };
type SupportTicketDetail = SupportTicket & {
  orderId: string | null; requesterName: string | null; requesterPhone: string | null;
  messages: Array<{ id: string; senderUserId: string; body: string; createdAt: string }>;
};
const MERCHANT_PERMISSIONS = [
  "orders:manage", "catalog:manage", "settings:manage", "staff:manage",
  "finance:view", "communication:manage", "support:manage", "audit:view"
] as const;

function defaultPermissions(role: "manager" | "staff"): string[] {
  return role === "manager"
    ? ["orders:manage", "catalog:manage", "settings:manage", "finance:view", "communication:manage", "support:manage", "audit:view"]
    : ["orders:manage", "communication:manage"];
}
type UserSession = { id: string; userAgent: string | null; isCurrent: boolean; createdAt: string; expiresAt: string };
type AuditEntry = { id: string; actorUserId: string; actorName: string | null; action: string; entityType: string; entityId: string | null; metadata: Record<string, unknown>; createdAt: string };

type MerchantOrder = {
  id: string; orderNumber: string; status: string; paymentStatus: string; totalMinor: number; currency: string;
  deliveryAddress: string | null; itemCount: number; deliveryEstimateMinutes: number | null; createdAt: string;
};

type OrderEventRecord = { id: string; fromStatus: string | null; toStatus: string; actorUserId: string | null; metadata: Record<string, unknown>; createdAt: string };

type MerchantOrderDetail = {
  id: string; orderNumber: string; status: string; paymentStatus: string; currency: string;
  fulfillmentType: string; deliveryAddress: Record<string, unknown>; deliveryInstructions: string | null;
  scheduledFor: string | null; deliveryEstimateMinutes: number | null; deliveryCode: string | null;
  totals: { itemsSubtotalMinor: number; deliveryFeeMinor: number; serviceFeeMinor: number; discountMinor: number; taxMinor: number; tipMinor: number; totalMinor: number; currency: string };
  items: Array<{ displayName: string; quantity: number; unitPriceMinor: number; lineTotalMinor: number }>;
  timeline: OrderEventRecord[];
  delivery: { status: string | null; courier: { displayName: string | null; phoneE164: string | null; vehicleType: string | null; rating: number | null } | null; acceptedAt: string | null; pickedUpAt: string | null; deliveredAt: string | null } | null;
  refunds: Array<{ id: string; status: string; amountMinor: number; reason: string; createdAt: string }>;
};

type MenuProduct = {
  id: string; categoryId: string | null; sku: string | null; displayName: string; description: string | null;
  imageUrl: string | null; basePriceMinor: number; currency: string; isAvailable: boolean; quantityAvailable: number; prepMinutes: number; archivedAt: string | null;
};

type MenuResponse = {
  categories: Array<{ id: string; slug: string; displayName: string; sortOrder: number }>;
  products: MenuProduct[];
};

type MerchantOption = { id: string; displayName: string; priceDeltaMinor: number; isDefault: boolean; isAvailable: boolean; sortOrder: number };
type MerchantOptionGroup = { id: string; displayName: string; selectionType: string; isRequired: boolean; minSelections: number; maxSelections: number; options: MerchantOption[] };

type Settlement = {
  id: string; periodStart: string; periodEnd: string; grossMinor: number; commissionMinor: number;
  netPayableMinor: number; currency: string; status: string; paidAt: string | null;
};

type MerchantDocument = {
  id: string; merchantId: string; documentType: string; storageKey: string; status: string;
  reviewNotes: string | null; reviewedAt: string | null; createdAt: string;
};

type MerchantSalesSummary = {
  period: { from: string; to: string; days: number };
  currency: string;
  commissionBps: number;
  orders: { received: number; accepted: number; delivered: number; cancelled: number; acceptanceRate: number; avgPrepMinutes: number };
  grossSalesMinor: number; deliveryFeesMinor: number; serviceFeesMinor: number; taxMinor: number; tipsMinor: number;
  refundsMinor: number; commissionMinor: number; netAfterCommissionMinor: number; averageOrderMinor: number;
  calculationRules: { currency: string; commissionBps: number; commissionRatePercent: number; grossSalesFormula: string; commissionFormula: string; netFormula: string; refundFormula: string; averageOrderFormula: string };
};

type MerchantProductPerformance = {
  days: number; currency: string; grossSalesMinor: number;
  items: Array<{ productId: string; displayName: string; categoryLabel: string | null; quantity: number; revenueMinor: number; sharePercent: number }>;
  bestSellers: Array<{ productId: string; displayName: string; quantity: number; revenueMinor: number }>;
};

type MerchantReviewSummary = {
  average: number; count: number; distribution: Record<string, number>;
  items: Array<{ id: string; merchantRating: number; courierRating: number | null; comment: string | null; customerName: string | null; createdAt: string }>;
};

const MERCHANT_DOCUMENT_TYPES = ["business_registration", "tax_identification", "trading_license", "operating_permit", "insurance", "profile_photo"];
const BULK_IMPORT_PLACEHOLDER = '[{"displayName":"Tibs","basePriceMinor":24000,"currency":"ETB","initialStock":5}]';

export default function MerchantHome() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);

  if (!ready) return <div className="boot">Loading workspace…</div>;
  if (!session) return <Login onAuthenticated={setSession} />;
  return <Workspace session={session} onSignOut={() => { void logout().finally(() => setSession(null)); }} />;
}

function Login({ onAuthenticated }: { onAuthenticated: (session: Session) => void }) {
  const [phone, setPhone] = useState("+251911000001");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function sendCode(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true); setError(null);
    try {
      const challenge = await requestOtp(phone.trim());
      setChallengeId(challenge.challengeId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not request a code.");
    } finally {
      setBusy(false);
    }
  }

  async function submitCode(event: React.FormEvent) {
    event.preventDefault();
    if (!challengeId) return;
    setBusy(true); setError(null);
    try {
      onAuthenticated(await verifyOtp(phone.trim(), code.trim(), challengeId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the code.");
    } finally {
      setBusy(false);
    }
  }

  return <main className="login-shell">
    <section className="login-copy">
      <p className="eyebrow">DELIVERY_APP / MERCHANT</p>
      <h1>Run the counter.<br />We handle the route.</h1>
      <p className="lede">Accept orders, keep the menu accurate, and know exactly what you will be paid.</p>
      <div className="login-facts">
        <p><span>01</span> Opaque, revocable staff sessions</p>
        <p><span>02</span> ETB pricing in exact minor units</p>
        <p><span>03</span> Every fulfilment action is audited</p>
      </div>
    </section>
    <section className="login-card">
      <p className="eyebrow">STAFF SIGN IN</p>
      <h2>{challengeId ? "Enter the six-digit code" : "Start with your phone"}</h2>
      {!challengeId ? <form onSubmit={sendCode}>
        <label>Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} inputMode="tel" autoComplete="tel" placeholder="+251911000001" required /></label>
        <button disabled={busy}>{busy ? "Requesting…" : "Send verification code"}</button>
      </form> : <form onSubmit={submitCode}>
        <label>Verification code<input value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} inputMode="numeric" autoComplete="one-time-code" placeholder="000000" pattern="\d{6}" required /></label>
        <button disabled={busy || code.length !== 6}>{busy ? "Verifying…" : "Open workspace"}</button>
        <button type="button" className="link-button" onClick={() => { setChallengeId(null); setCode(""); }}>Use another number</button>
      </form>}
      {error ? <p className="form-error">{error}</p> : null}
      <p className="fine-print">Development builds can use the OTP configured by <code>OTP_DEVELOPMENT_CODE</code>. Merchant accounts must already be linked by an operator.</p>
    </section>
  </main>;
}

function Workspace({ session, onSignOut }: { session: Session; onSignOut: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [orderStatus, setOrderStatus] = useState("");
  const [me, setMe] = useState<MerchantMe | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [toast, setToast] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setMe(await api<MerchantMe>("/v1/merchant/me"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the merchant account.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    if (!toast) return;
    const timer = window.setTimeout(() => setToast(null), 3500);
    return () => window.clearTimeout(timer);
  }, [toast]);

  const name = me?.merchant.displayName ?? session.user.displayName ?? "Merchant";
  const initials = name.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase();
  const navItems = NAV_ITEMS.map((item) => item.value === "orders" && me?.stats.pendingOrders
    ? { ...item, badge: me.stats.pendingOrders }
    : item
  );

  return <div className="app-shell">
    <main className="workspace">
      <header className="workspace-topbar">
        <div className="brand"><span className="brand-mark">d</span><div><strong>delivery_app</strong><small>merchant</small></div></div>
        <div className="workspace-user">
          <div className="avatar">{initials}</div>
          <div className="workspace-user-text">
            <strong>{session.user.displayName ?? session.user.phoneE164}</strong>
            <small>{me?.membership.role ?? "staff"}</small>
          </div>
          <button className="ghost" onClick={onSignOut}>Sign out</button>
        </div>
      </header>
      <header className="workspace-head">
        <div>
          <p className="eyebrow">{tab.toUpperCase()}</p>
          <h1>{tabTitle(tab, name)}</h1>
        </div>
        {me ? <div className={`status-pill ${me.merchant.status}`}>{me.merchant.status}</div> : null}
      </header>

      {tab === "orders" ? <div className="context-strip">
        <FloatingCategoryBar
          items={ORDER_FILTERS}
          value={orderStatus}
          onChange={setOrderStatus}
          label="Order status filters"
        />
      </div> : null}

      {loading && !me ? <div className="panel empty">Loading merchant…</div> : null}
      {error && !me ? <div className="panel empty">
        <h2>Workspace unavailable</h2>
        <p>{error}</p>
        <p className="muted">This phone must be linked to a merchant by an operator before staff can sign in.</p>
        <button onClick={() => void refresh()}>Try again</button>
      </div> : null}

      {me && tab === "overview" ? <Overview me={me} reload={refresh} notify={setToast} /> : null}
      {me && tab === "live" ? <section className="panel live-map">
        <div className="panel-head"><div><p className="eyebrow">DELIVERY TRACKING</p><h2>Live map</h2></div><span className="fine-print">Your active deliveries</span></div>
        <LiveMap session={session} />
      </section> : null}
      {me && tab === "orders" ? <Orders notify={setToast} status={orderStatus} /> : null}
      {me && tab === "menu" ? <Menu me={me} reload={refresh} notify={setToast} /> : null}
      {me && tab === "sales" ? <Sales notify={setToast} /> : null}
      {me && tab === "settlements" ? <Settlements /> : null}
      {me && tab === "finance" ? <Finance /> : null}
      {me && tab === "business" ? <Business me={me} reload={refresh} notify={setToast} /> : null}
      {me && tab === "control" ? <ControlCenter me={me} notify={setToast} /> : null}
    </main>
    <FloatingDock>
      <FloatingNav
        items={navItems}
        value={tab}
        onChange={(value) => {
          setTab(value as Tab);
          if (value !== "orders") setOrderStatus("");
        }}
        label="Merchant sections"
      />
    </FloatingDock>
    {toast ? <div className="toast">{toast}</div> : null}
  </div>;
}

function tabTitle(tab: Tab, name: string): string {
  switch (tab) {
    case "overview": return name;
    case "live": return "Live delivery map";
    case "orders": return "Order queue";
    case "menu": return "Menu & stock";
    case "sales": return "Sales & analytics";
    case "settlements": return "Settlement history";
    case "finance": return "Finance";
    case "business": return "Store & business";
    case "control": return "People, security & support";
  }
}

function Overview({ me, reload, notify }: { me: MerchantMe; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(me.merchant.displayName);
  const [description, setDescription] = useState(me.merchant.description ?? "");
  const [saving, setSaving] = useState(false);
  const [savingLocationId, setSavingLocationId] = useState<string | null>(null);

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    try {
      await api("/v1/merchant/me", { method: "PATCH", body: JSON.stringify({ displayName, description }) });
      notify("Merchant profile updated.");
      setEditing(false);
      await reload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the profile.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleLocation(location: MerchantLocation) {
    setSavingLocationId(location.id);
    try {
      await api(`/v1/merchant/locations/${location.id}`, { method: "PATCH", body: JSON.stringify({ active: !location.isActive }) });
      notify(`${location.name} is now ${location.isActive ? "closed" : "open"}.`);
      await reload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the location.");
    } finally {
      setSavingLocationId(null);
    }
  }

  const m = me.merchant;
  const canEdit = me.membership.role === "owner" || me.membership.permissions.includes("settings:manage");

  return <>
    {m.status !== "active" ? <section className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">APPLICATION</p><h2>{m.status === "pending" ? "Awaiting operator approval" : m.status}</h2></div>
        <span className={`status-pill ${m.status}`}>{m.status}</span>
      </div>
      <p className="muted">
        {m.status === "pending" ? "The operations team is reviewing this merchant application. You will be able to fulfil orders once approved."
          : m.status === "suspended" ? "This merchant account is suspended. Store operations are paused until an operator reactivates it."
          : m.status === "closed" ? "This merchant account is closed." : "This merchant account is not active."}
      </p>
      {m.rejectionReason ? <p className="form-error">Rejection reason: {m.rejectionReason}</p> : null}
      {m.suspensionReason ? <p className="form-error">Suspension reason: {m.suspensionReason}</p> : null}
      {m.status === "pending" ? <p className="fine-print">No orders can be accepted until an authorised operator approves the application. Verification documents and store details may still be submitted below.</p> : null}
    </section> : null}

    <section className="metric-grid">
      <article className="metric"><span>Today</span><strong>{me.stats.todayOrders}</strong><p>orders received</p></article>
      <article className="metric accent"><span>Needs action</span><strong>{me.stats.pendingOrders}</strong><p>orders waiting on the kitchen</p></article>
      <article className="metric"><span>Revenue today</span><strong>{money(me.stats.revenueTodayMinor)}</strong><p>before platform fees</p></article>
      <article className="metric"><span>Commission</span><strong>{(me.merchant.commissionBps / 100).toFixed(1)}%</strong><p>on item subtotal</p></article>
    </section>

    <div className="two-column">
      <section className="panel">
        <div className="panel-head">
          <div><p className="eyebrow">PROFILE</p><h2>{me.merchant.displayName}</h2></div>
          {canEdit ? <button className="ghost" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel" : "Edit"}</button> : null}
        </div>
        {editing ? <form className="stack" onSubmit={saveProfile}>
          <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={120} required /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={2000} /></label>
          <button disabled={saving}>{saving ? "Saving…" : "Save profile"}</button>
        </form> : <>
          <p className="muted">{me.merchant.description ?? "No public description yet."}</p>
          <dl className="detail-list">
            <div><dt>Slug</dt><dd>/{me.merchant.slug}</dd></div>
            <div><dt>Your role</dt><dd>{me.membership.role}</dd></div>
            <div><dt>Locations</dt><dd>{me.locations.length}</dd></div>
            <div><dt>Menu categories</dt><dd>{me.categories.length}</dd></div>
            <div><dt>Delivery radius</dt><dd>{me.merchant.deliveryRadiusKm} km</dd></div>
            <div><dt>Cancellation policy</dt><dd>{me.merchant.cancellationPolicy ?? "Not set"}</dd></div>
            <div><dt>Refund policy</dt><dd>{me.merchant.refundPolicy ?? "Not set"}</dd></div>
          </dl>
        </>}
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">LOCATIONS</p><h2>Availability</h2></div></div>
        {me.locations.length === 0 ? <p className="muted">No locations have been configured.</p> : <div className="location-list">
          {me.locations.map((location) => <article key={location.id} className="location-row">
            <div><strong>{location.name}</strong><p>{location.addressLine}</p></div>
            <button className={location.isActive ? "toggle on" : "toggle"} disabled={savingLocationId === location.id} onClick={() => void toggleLocation(location)}>{savingLocationId === location.id ? "Saving…" : location.isActive ? "Open" : "Closed"}</button>
          </article>)}
        </div>}
      </section>
    </div>
  </>
}

function Orders({ notify, status }: { notify: (message: string) => void; status: string }) {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [detail, setDetail] = useState<MerchantOrderDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const seenRef = useRef<string[]>([]);
  const loadedOnceRef = useRef(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const result = await api<{ items: MerchantOrder[]; total: number }>(`/v1/merchant/orders${query}`);
      setOrders(result.items); setTotal(result.total);
      const actionable = result.items.filter((order) => order.status === "AWAITING_PAYMENT" || order.status === "PENDING_CONFIRMATION");
      if (loadedOnceRef.current) {
        for (const order of actionable) {
          if (!seenRef.current.includes(order.id)) {
            seenRef.current = [...seenRef.current, order.id];
            notify(`New incoming order ${order.orderNumber}.`);
          }
        }
      }
      loadedOnceRef.current = true;
      seenRef.current = actionable.map((order) => order.id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, [status, notify]);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => void load(), 20000);
    return () => window.clearInterval(timer);
  }, [load]);

  async function transition(order: MerchantOrder, action: "accept" | "prepare" | "ready" | "reject") {
    let reason: string | undefined;
    if (action === "reject") {
      reason = window.prompt("Why are you rejecting this order?")?.trim();
      if (!reason) return;
    }
    setBusyId(order.id);
    try {
      await api(`/v1/merchant/orders/${order.id}/${action}`, { method: "POST", body: JSON.stringify(reason ? { reason } : {}) });
      notify(`Order ${order.orderNumber} updated.`);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the order.");
    } finally {
      setBusyId(null);
    }
  }

  async function openOrder(order: MerchantOrder) {
    setSelectedId(order.id);
    setDetailLoading(true);
    try {
      const fetched = (await api(`/v1/merchant/orders/${order.id}`)) as MerchantOrderDetail;
      setDetail(fetched);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not load the order.");
    } finally {
      setDetailLoading(false);
    }
  }

  const visibleOrders = orders.filter((order) => !search.trim() || order.orderNumber.toLowerCase().includes(search.trim().toLowerCase()));

  return (
    <>
      {selectedId && detail ? (
        <section className="panel stack">
          <div className="panel-head">
            <div><p className="eyebrow">ORDER DETAIL</p><h2>{detail.orderNumber}</h2></div>
            <button className="ghost" onClick={() => { setSelectedId(null); setDetail(null); }}>Close</button>
          </div>
          <div className="order-meta">
            <span>Status</span><span>{detail.status.replaceAll("_", " ")}</span>
            <span>Payment</span><span>{detail.paymentStatus.replaceAll("_", " ")}</span>
            <span>Fulfillment</span><span>{detail.fulfillmentType}</span>
            <span>Delivery estimate</span><span>{detail.deliveryEstimateMinutes ? `~${detail.deliveryEstimateMinutes} min` : "—"}</span>
            <span>Scheduled</span><span>{detail.scheduledFor ? new Date(detail.scheduledFor).toLocaleString() : "—"}</span>
          </div>
          <div className="metric-grid">
            <article className="metric"><span>Items subtotal</span><strong>{money(detail.totals.itemsSubtotalMinor, detail.totals.currency)}</strong></article>
            <article className="metric"><span>Delivery fee</span><strong>{money(detail.totals.deliveryFeeMinor, detail.totals.currency)}</strong></article>
            <article className="metric"><span>Service fee</span><strong>{money(detail.totals.serviceFeeMinor, detail.totals.currency)}</strong></article>
            <article className="metric"><span>Discount</span><strong>{money(detail.totals.discountMinor, detail.totals.currency)}</strong></article>
            <article className="metric"><span>Tax</span><strong>{money(detail.totals.taxMinor, detail.totals.currency)}</strong></article>
            <article className="metric"><span>Tip</span><strong>{money(detail.totals.tipMinor, detail.totals.currency)}</strong></article>
            <article className="metric accent"><span>Total</span><strong>{money(detail.totals.totalMinor, detail.totals.currency)}</strong></article>
          </div>
          <section className="panel">
            <div className="panel-head"><div><p className="eyebrow">ITEMS</p><h2>Line items</h2></div></div>
            <div className="stack">
              {detail.items.map((item) => (
                <div className="flag-row" key={`${item.displayName}-${item.quantity}`}>
                  <div><strong>{item.displayName}</strong><small className="block">×{item.quantity}</small></div>
                  <span>{money(item.lineTotalMinor, detail.totals.currency)}</span>
                </div>
              ))}
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><div><p className="eyebrow">DELIVERY</p><h2>Courier & handoff</h2></div></div>
            <div className="order-meta">
              <span>Assignment</span><span>{detail.delivery?.status ? detail.delivery.status.replaceAll("_", " ") : "—"}</span>
              <span>Courier</span><span>{detail.delivery?.courier ? `${detail.delivery.courier.displayName ?? "Unknown"}${detail.delivery.courier.phoneE164 ? ` · ${detail.delivery.courier.phoneE164}` : ""}` : "—"}</span>
              <span>Picked up</span><span>{detail.delivery?.pickedUpAt ? new Date(detail.delivery.pickedUpAt).toLocaleString() : "—"}</span>
              <span>Delivered</span><span>{detail.delivery?.deliveredAt ? new Date(detail.delivery.deliveredAt).toLocaleString() : "—"}</span>
            </div>
          </section>
          <section className="panel">
            <div className="panel-head"><div><p className="eyebrow">HISTORY</p><h2>Order timeline</h2></div></div>
            <div className="stack">
              {detail.timeline.length === 0 ? <p className="muted">No status events recorded yet.</p> : detail.timeline.map((event) => (
                <div className="flag-row" key={event.id}>
                  <div><strong>{event.toStatus.replaceAll("_", " ")}</strong><small className="block">{event.fromStatus ? `from ${event.fromStatus.replaceAll("_", " ")}` : "initial"}</small><small className="block">{new Date(event.createdAt).toLocaleString()}</small></div>
                </div>
              ))}
            </div>
          </section>
        </section>
      ) : null}
      <section className="panel">
        <div className="panel-head">
          <div><p className="eyebrow">FULFILMENT</p><h2>{total} orders</h2></div>
          <div className="toolbar-inline">
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search order number" />
            <button className="ghost" onClick={() => void load()}>Refresh</button>
          </div>
        </div>
    {loading ? <p className="muted">Loading orders…</p> : error ? <p className="form-error">{error}</p> : visibleOrders.length === 0 ? <div className="empty"><h3>No orders here</h3><p>The queue is clear for this filter.</p></div> : <div className="order-list">
      {visibleOrders.map((order) => <article key={order.id} className="order-card">
        <div className="order-head">
          <div><strong>{order.orderNumber}</strong><p>{new Date(order.createdAt).toLocaleString()}</p></div>
          <div className="order-total"><strong>{money(order.totalMinor, order.currency)}</strong><span className={`status-text ${order.status.toLowerCase()}`}>{order.status.replaceAll("_", " ")}</span></div>
        </div>
        <div className="order-meta">
          <span>{order.itemCount} items</span>
          <span>{order.deliveryAddress ?? "Address unavailable"}</span>
          <span>{order.paymentStatus.replaceAll("_", " ")}</span>
          {order.deliveryEstimateMinutes ? <span>~{order.deliveryEstimateMinutes} min</span> : null}
        </div>
        <div className="order-actions">
          {["PENDING_CONFIRMATION", "AWAITING_PAYMENT", "CONFIRMED"].includes(order.status) ? <button disabled={busyId === order.id} onClick={() => void transition(order, "accept")}>Accept</button> : null}
          {order.status === "ACCEPTED_BY_MERCHANT" ? <button disabled={busyId === order.id} onClick={() => void transition(order, "prepare")}>Start preparing</button> : null}
          {order.status === "PREPARING" ? <button disabled={busyId === order.id} onClick={() => void transition(order, "ready")}>Mark ready</button> : null}
          {!["DELIVERED", "CANCELLED", "REFUNDED", "REFUND_PENDING", "FAILED", "PICKED_UP", "IN_TRANSIT"].includes(order.status) ? <button className="danger" disabled={busyId === order.id} onClick={() => void transition(order, "reject")}>Reject</button> : null}
        </div>
      </article>)}
        </div>}
      </section>
    </>
  );
}

function Menu({ me, reload, notify }: { me: MerchantMe; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [menu, setMenu] = useState<MenuResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [price, setPrice] = useState("");
  const [stock, setStock] = useState("0");
  const [categoryId, setCategoryId] = useState("");
  const [creating, setCreating] = useState(false);
  const [categoryName, setCategoryName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [edit, setEdit] = useState<{ displayName: string; description: string; imageUrl: string; basePriceMinor: string; categoryId: string; isAvailable: boolean; prepMinutes: string } | null>(null);
  const [bulkText, setBulkText] = useState("");
  const [bulkBusy, setBulkBusy] = useState(false);
  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [categoryDraft, setCategoryDraft] = useState<{ displayName: string; sortOrder: string } | null>(null);
  const [savingCategory, setSavingCategory] = useState(false);
  const [optionGroups, setOptionGroups] = useState<MerchantOptionGroup[]>([]);
  const [optionGroupName, setOptionGroupName] = useState("");
  const [optionName, setOptionName] = useState("");
  const [optionPriceDelta, setOptionPriceDelta] = useState("0");
  const [busyOption, setBusyOption] = useState(false);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      setMenu(await api<MenuResponse>("/v1/merchant/menu"));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load the menu.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  async function createProduct(event: React.FormEvent) {
    event.preventDefault();
    const priceMinor = Math.round(Number(price) * 100);
    if (!Number.isFinite(priceMinor) || priceMinor < 0) return notify("Enter a valid ETB price.");
    setCreating(true);
    try {
      await api("/v1/merchant/products", {
        method: "POST",
        body: JSON.stringify({
          displayName: name.trim(), basePriceMinor: priceMinor, currency: "ETB",
          initialStock: Number(stock) || 0, categoryId: categoryId || undefined
        })
      });
      notify(`${name} added to the menu.`);
      setName(""); setPrice(""); setStock("0");
      await Promise.all([load(), reload()]);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not create the product.");
    } finally {
      setCreating(false);
    }
  }

  async function createCategory(event: React.FormEvent) {
    event.preventDefault();
    const slug = categoryName.toLowerCase().trim().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    if (!slug) return notify("Enter a category name.");
    try {
      await api("/v1/merchant/categories", { method: "POST", body: JSON.stringify({ slug, displayName: categoryName.trim() }) });
      notify("Category created.");
      setCategoryName("");
      await Promise.all([load(), reload()]);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not create the category.");
    }
  }

  async function startEditCategory(category: { id: string; displayName: string; sortOrder: number }) {
    setEditingCategoryId(category.id);
    setCategoryDraft({ displayName: category.displayName, sortOrder: String(category.sortOrder) });
  }

  async function saveCategoryEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingCategoryId || !categoryDraft) return;
    setSavingCategory(true);
    try {
      await api(`/v1/merchant/categories/${editingCategoryId}`, { method: "PATCH", body: JSON.stringify({ displayName: categoryDraft.displayName, sortOrder: Number(categoryDraft.sortOrder) || 0 }) });
      notify("Category updated.");
      setEditingCategoryId(null); setCategoryDraft(null);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the category.");
    } finally {
      setSavingCategory(false);
    }
  }

  async function archiveCategory(category: { id: string; displayName: string }) {
    try {
      await api(`/v1/merchant/categories/${category.id}/archive`, { method: "POST" });
      notify(`${category.displayName} archived.`);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not archive the category.");
    }
  }

  async function setInventory(product: MenuProduct, quantity: number) {
    try {
      await api(`/v1/merchant/products/${product.id}/inventory`, { method: "PATCH", body: JSON.stringify({ quantity }) });
      notify(`${product.displayName} stock set to ${quantity}.`);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update stock.");
    }
  }

  async function toggleProduct(product: MenuProduct) {
    try {
      await api(`/v1/merchant/products/${product.id}`, { method: "PATCH", body: JSON.stringify({ isAvailable: !product.isAvailable }) });
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the product.");
    }
  }

  async function startEdit(product: MenuProduct) {
    setEditingId(product.id);
    setEdit({
      displayName: product.displayName,
      description: product.description ?? "",
      imageUrl: product.imageUrl ?? "",
      basePriceMinor: (product.basePriceMinor / 100).toFixed(2),
      categoryId: product.categoryId ?? "",
      isAvailable: product.isAvailable,
      prepMinutes: String(product.prepMinutes ?? 0)
    });
    setOptionGroups([]);
    try {
      const result = await api<{ groups: MerchantOptionGroup[] }>(`/v1/merchant/products/${product.id}/options`);
      setOptionGroups(result.groups ?? []);
    } catch {
      setOptionGroups([]);
    }
  }

  async function createOptionGroup(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId) return;
    const displayName = optionGroupName.trim();
    if (!displayName) return notify("Enter an option group name.");
    try {
      const result = await api<{ id: string; displayName: string }>(`/v1/merchant/products/${editingId}/options`, { method: "POST", body: JSON.stringify({ displayName }) });
      notify(`Option group "${result.displayName}" created.`);
      setOptionGroupName("");
      const refreshed = await api<{ groups: MerchantOptionGroup[] }>(`/v1/merchant/products/${editingId}/options`);
      setOptionGroups(refreshed.groups ?? []);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not create the option group.");
    }
  }

  async function createOption(groupId: string, event: React.FormEvent) {
    event.preventDefault();
    const displayName = optionName.trim();
    const priceDelta = Math.round(Number(optionPriceDelta) * 100);
    if (!displayName || !Number.isFinite(priceDelta) || priceDelta < 0) return notify("Enter a valid option name and price delta.");
    setBusyOption(true);
    try {
      await api(`/v1/merchant/products/${editingId}/options/${groupId}`, { method: "POST", body: JSON.stringify({ displayName, priceDeltaMinor: priceDelta }) });
      notify(`${displayName} option added.`);
      setOptionName(""); setOptionPriceDelta("0");
      const refreshed = await api<{ groups: MerchantOptionGroup[] }>(`/v1/merchant/products/${editingId}/options`);
      setOptionGroups(refreshed.groups ?? []);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not add the option.");
    } finally {
      setBusyOption(false);
    }
  }

  async function toggleOption(optionId: string, available: boolean) {
    try {
      await api(`/v1/merchant/products/options/${optionId}`, { method: "PATCH", body: JSON.stringify({ isAvailable: available }) });
      const refreshed = await api<{ groups: MerchantOptionGroup[] }>(`/v1/merchant/products/${editingId}/options`);
      setOptionGroups(refreshed.groups ?? []);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the option.");
    }
  }

  async function deleteOption(optionId: string) {
    try {
      await api(`/v1/merchant/products/options/${optionId}`, { method: "DELETE" });
      const refreshed = await api<{ groups: MerchantOptionGroup[] }>(`/v1/merchant/products/${editingId}/options`);
      setOptionGroups(refreshed.groups ?? []);
      notify("Option deleted.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not delete the option.");
    }
  }

  async function saveEdit(event: React.FormEvent) {
    event.preventDefault();
    if (!editingId || !edit) return;
    const priceMinor = Math.round(Number(edit.basePriceMinor) * 100);
    if (!Number.isFinite(priceMinor) || priceMinor < 0) return notify("Enter a valid ETB price.");
    setCreating(true);
    try {
      await api(`/v1/merchant/products/${editingId}`, {
        method: "PATCH",
        body: JSON.stringify({
          displayName: edit.displayName, description: edit.description, imageUrl: edit.imageUrl, basePriceMinor: priceMinor,
          categoryId: edit.categoryId || undefined, isAvailable: edit.isAvailable, prepMinutes: Number(edit.prepMinutes) || 0
        })
      });
      notify("Product updated.");
      setEditingId(null); setEdit(null);
      await Promise.all([load(), reload()]);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the product.");
    } finally {
      setCreating(false);
    }
  }

  async function archiveProduct(product: MenuProduct) {
    try {
      await api(`/v1/merchant/products/${product.id}/archive`, { method: "POST" });
      notify(`${product.displayName} archived.`);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not archive the product.");
    }
  }

  async function restoreProduct(product: MenuProduct) {
    try {
      await api(`/v1/merchant/products/${product.id}/restore`, { method: "POST" });
      notify(`${product.displayName} restored.`);
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not restore the product.");
    }
  }

  async function runBulkImport(event: React.FormEvent) {
    event.preventDefault();
    let parsed: Array<Record<string, unknown>>;
    try { parsed = JSON.parse(bulkText); } catch { return notify("Bulk import must be a JSON array of product rows."); }
    if (!Array.isArray(parsed) || parsed.length === 0) return notify("Bulk import needs at least one product row.");
    setBulkBusy(true);
    try {
      const items = (parsed as Array<Record<string, unknown>>).map((row) => ({
        displayName: String(row.displayName ?? ""),
        basePriceMinor: Number(row.basePriceMinor ?? 0),
        currency: String(row.currency ?? "ETB"),
        categoryId: typeof row.categoryId === "string" ? row.categoryId : undefined,
        sku: typeof row.sku === "string" ? row.sku : undefined,
        description: typeof row.description === "string" ? row.description : undefined,
        imageUrl: typeof row.imageUrl === "string" ? row.imageUrl : undefined,
        initialStock: typeof row.initialStock === "number" ? row.initialStock : undefined
      }));
      const result = await api<{ created: number; failed: Array<{ displayName: string; error: string }> }>("/v1/merchant/products/bulk", { method: "POST", body: JSON.stringify({ items }) });
      notify(`Imported ${result.created} products${result.failed && result.failed.length ? `; ${result.failed.length} failed` : ""}.`);
      setBulkText("");
      await load();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not run the bulk import.");
    } finally {
      setBulkBusy(false);
    }
  }

  async function exportMenu() {
    try {
      const result = await api<{ items: Array<Record<string, unknown>> }>("/v1/merchant/products/export");
      const blob = new Blob([JSON.stringify(result.items, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = "merchant-menu-export.json"; anchor.click(); URL.revokeObjectURL(url);
      notify(`Exported ${result.items.length} products.`);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not export the menu.");
    }
  }

  const categoriesById = useMemo(() => new Map((menu?.categories ?? []).map((category) => [category.id, category.displayName])), [menu]);
  const editingProduct = menu?.products.find((product) => product.id === editingId) ?? null;
  const editingCategory = menu?.categories.find((category) => category.id === editingCategoryId) ?? null;

  return <div className="menu-layout">
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">CATALOGUE</p><h2>{menu?.products.length ?? 0} products</h2></div><button className="ghost" onClick={() => void load()}>Refresh</button></div>
      {loading ? <p className="muted">Loading menu…</p> : error ? <p className="form-error">{error}</p> : menu && menu.products.length > 0 ? (
        <div className="product-list">
          {menu.products.map((product) => (
            <article key={product.id} className="product-row">
              <div className="product-main">
                <strong>{product.displayName}</strong>
                <p>{categoriesById.get(product.categoryId ?? "") ?? "Uncategorised"} · {money(product.basePriceMinor, product.currency)} · prep {product.prepMinutes} min</p>
              </div>
              <div className="stock-control">
                <label>Stock<input type="number" min={0} defaultValue={product.quantityAvailable} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value !== product.quantityAvailable) void setInventory(product, value); }} /></label>
                <button className={product.isAvailable ? "toggle on" : "toggle"} onClick={() => void toggleProduct(product)}>{product.isAvailable ? "Available" : "Hidden"}</button>
              </div>
              <div className="product-actions">
                <button className="ghost" onClick={() => void startEdit(product)}>{editingId === product.id ? "Close" : "Edit"}</button>
                {product.archivedAt ? <button className="ghost" onClick={() => void restoreProduct(product)}>Restore</button> : <button className="ghost danger" onClick={() => void archiveProduct(product)}>Archive</button>}
              </div>
            </article>
          ))}
          {editingProduct ? (
            <section className="panel stack">
              <div className="panel-head">
                <div><p className="eyebrow">EDIT PRODUCT</p><h2>{editingProduct.displayName}</h2></div>
                <button className="ghost" onClick={() => { setEditingId(null); setEdit(null); }}>Close</button>
              </div>
              <form className="stack" onSubmit={saveEdit}>
                <label>Name<input value={edit?.displayName ?? ""} onChange={(event) => setEdit((current) => current ? { ...current, displayName: event.target.value } : current)} minLength={2} maxLength={160} required /></label>
                <label>Description<textarea value={edit?.description ?? ""} onChange={(event) => setEdit((current) => current ? { ...current, description: event.target.value } : current)} rows={3} maxLength={2000} /></label>
                <div className="form-grid">
                  <label>Price (ETB)<input value={edit?.basePriceMinor ?? ""} onChange={(event) => setEdit((current) => current ? { ...current, basePriceMinor: event.target.value } : current)} inputMode="decimal" required /></label>
                  <label>Preparation minutes<input value={edit?.prepMinutes ?? "0"} onChange={(event) => setEdit((current) => current ? { ...current, prepMinutes: event.target.value } : current)} type="number" min={0} /></label>
                </div>
                <div className="form-grid">
                  <label>Category<select value={edit?.categoryId ?? ""} onChange={(event) => setEdit((current) => current ? { ...current, categoryId: event.target.value } : current)}><option value="">Uncategorised</option>{menu?.categories.map((category) => <option key={category.id} value={category.id}>{category.displayName}</option>)}</select></label>
                  <div className="stack" style={{ gap: "0.3rem" }}>
                    <span>Availability</span>
                    <div className="stack" style={{ flexDirection: "row", gap: "0.5rem" }}>
                      <button type="button" className={edit?.isAvailable ? "toggle on" : "toggle"} onClick={() => setEdit((current) => current ? { ...current, isAvailable: true } : current)}>Available</button>
                      <button type="button" className={!edit?.isAvailable ? "toggle on" : "toggle"} onClick={() => setEdit((current) => current ? { ...current, isAvailable: false } : current)}>Hidden</button>
                    </div>
                  </div>
                </div>
                <label>Image URL<input value={edit?.imageUrl ?? ""} onChange={(event) => setEdit((current) => current ? { ...current, imageUrl: event.target.value } : current)} maxLength={500} placeholder="https://cdn.example.com/item.png" /></label>
                <button disabled={creating}>{creating ? "Saving…" : "Save product"}</button>
              </form>
              <section className="panel stack">
                <div className="panel-head"><div><p className="eyebrow">OPTIONS</p><h2>Variants & customisations</h2></div></div>
                <p className="muted">Sizes, packs and customisation extras with price adjustments. Customers pick one option per line at checkout.</p>
                {optionGroups.length === 0 ? <p className="muted">No option groups for this product yet.</p> : optionGroups.map((group) => (
                  <div className="stack" key={group.id}>
                    <div className="order-head">
                      <div><strong>{group.displayName}</strong><small className="block">{group.selectionType} · required {group.isRequired ? "yes" : "no"}{group.minSelections ? ` · min ${group.minSelections}` : ""}{group.maxSelections ? ` · max ${group.maxSelections}` : ""}</small></div>
                    </div>
                    <div className="stack">
                      {group.options.map((option) => (
                        <div className="flag-row" key={option.id}>
                          <div><strong>{option.displayName}</strong><small className="block">price adjustment {option.priceDeltaMinor ? `+${money(option.priceDeltaMinor)}` : "+0 ETB"}</small></div>
                          <div className="actions">
                            <button className="ghost" onClick={() => void toggleOption(option.id, !option.isAvailable)}>{option.isAvailable ? "Available" : "Hidden"}</button>
                            <button className="ghost danger" onClick={() => void deleteOption(option.id)}>Delete</button>
                          </div>
                        </div>
                      ))}
                      {group.options.length === 0 ? <p className="muted">No options in this group yet.</p> : null}
                    </div>
                    <form className="inline-form" onSubmit={(event) => void createOption(group.id, event)}>
                      <input value={optionName} onChange={(event) => setOptionName(event.target.value)} placeholder="Large" maxLength={120} />
                      <input value={optionPriceDelta} onChange={(event) => setOptionPriceDelta(event.target.value)} placeholder="0.00" inputMode="decimal" />
                      <button disabled={busyOption || !optionName.trim()}>Add option</button>
                    </form>
                  </div>
                ))}
                <form className="inline-form" onSubmit={(event) => void createOptionGroup(event)}>
                  <input value={optionGroupName} onChange={(event) => setOptionGroupName(event.target.value)} placeholder="Size" maxLength={120} />
                  <button disabled={!optionGroupName.trim()}>Add group</button>
                </form>
              </section>
            </section>
          ) : null}
        </div>
      ) : (
        <div className="empty"><h3>No products yet</h3><p>Add the first item using the form.</p></div>
      )}
    </section>

    <aside className="side-stack">
      <section className="panel">
        <p className="eyebrow">NEW PRODUCT</p><h2>Add to menu</h2>
        <form className="stack" onSubmit={createProduct}>
          <label>Name<input value={name} onChange={(event) => setName(event.target.value)} required maxLength={160} placeholder="Chicken tibs" /></label>
          <div className="form-grid">
            <label>Price (ETB)<input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" required placeholder="240.00" /></label>
            <label>Opening stock<input value={stock} onChange={(event) => setStock(event.target.value)} type="number" min={0} /></label>
          </div>
          <label>Category<select value={categoryId} onChange={(event) => setCategoryId(event.target.value)}><option value="">Uncategorised</option>{menu?.categories.map((category) => <option key={category.id} value={category.id}>{category.displayName}</option>)}</select></label>
          <button disabled={creating}>{creating ? "Adding…" : "Add product"}</button>
        </form>
      </section>
      <section className="panel">
        <p className="eyebrow">CATEGORY</p><h2>New category</h2>
        <form className="inline-form" onSubmit={createCategory}>
          <input value={categoryName} onChange={(event) => setCategoryName(event.target.value)} placeholder="Main dishes" maxLength={80} />
          <button disabled={!categoryName.trim()}>Add</button>
        </form>
        <div className="stack">
          {(menu?.categories ?? []).map((category) => (
            <div className="flag-row" key={category.id}>
              <div><strong>{category.displayName}</strong><small className="block">/{category.slug}</small></div>
              <div className="actions">
                <button className="ghost" onClick={() => startEditCategory(category)}>{editingCategoryId === category.id ? "Close" : "Edit"}</button>
                <button className="ghost danger" onClick={() => void archiveCategory(category)}>Archive</button>
              </div>
            </div>
          ))}
        </div>
        {editingCategory ? (
          <form className="stack" onSubmit={saveCategoryEdit}>
            <label>Name<input value={categoryDraft?.displayName ?? ""} onChange={(event) => setCategoryDraft((current) => current ? { ...current, displayName: event.target.value } : current)} required /></label>
            <label>Sort order<input value={categoryDraft?.sortOrder ?? "0"} onChange={(event) => setCategoryDraft((current) => current ? { ...current, sortOrder: event.target.value } : current)} type="number" min={0} /></label>
            <button disabled={savingCategory}>{savingCategory ? "Saving…" : "Save category"}</button>
          </form>
        ) : null}
        <p className="fine-print">{me.categories.length} categories currently on the menu.</p>
      </section>
      <section className="panel">
        <p className="eyebrow">CATALOGUE OPS</p><h2>Bulk import / export</h2>
        <form className="stack" onSubmit={(event) => void runBulkImport(event)}>
          <label>Bulk import (JSON array of product rows)<textarea rows={6} value={bulkText} onChange={(event) => setBulkText(event.target.value)} placeholder={BULK_IMPORT_PLACEHOLDER} /></label>
          <button disabled={bulkBusy}>{bulkBusy ? "Importing…" : "Run bulk import"}</button>
        </form>
        <button className="ghost" onClick={() => void exportMenu()}>Export menu JSON</button>
      </section>
    </aside>
  </div>;
}

function Sales({ notify }: { notify: (message: string) => void }) {
  const [days, setDays] = useState(30);
  const [summary, setSummary] = useState<MerchantSalesSummary | null>(null);
  const [products, setProducts] = useState<MerchantProductPerformance | null>(null);
  const [reviews, setReviews] = useState<MerchantReviewSummary | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const [sales, productRows, merchantReviewSummary] = await Promise.all([
        api<MerchantSalesSummary>(`/v1/merchant/analytics/sales?days=${days}`),
        api<MerchantProductPerformance>(`/v1/merchant/analytics/products?days=${days}`),
        api<MerchantReviewSummary>(`/v1/merchant/reviews?limit=20`)
      ]);
      setSummary(sales);
      setProducts(productRows);
      setReviews(merchantReviewSummary);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load sales analytics.");
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => { void load(); }, [load]);

  async function downloadReport() {
    try {
      const csv = await apiRaw(`/v1/merchant/reports/sales.csv?days=${days}`);
      const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = `merchant-sales-${days}d.csv`;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      URL.revokeObjectURL(url);
      notify("Sales report downloaded.");
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not download the sales report.");
    }
  }

  const distribution = reviews?.distribution ?? {};
  const maxRatingCount = Math.max(1, ...[1, 2, 3, 4, 5].map((rating) => Number(distribution[String(rating)] ?? distribution[String(rating)] ?? 0)));

  return (
    <div className="stack">
      <section className="panel">
        <div className="panel-head">
          <div><p className="eyebrow">SALES</p><h2>Sales & finance dashboard</h2></div>
          <div className="toolbar-inline">
            <div className="filter-row" style={{ marginBottom: 0 }}>
              {[7, 30, 365].map((option) => (
                <button key={option} type="button" className={days === option ? "chip active" : "chip"} onClick={() => setDays(option)}>{option} days</button>
              ))}
            </div>
            <button className="ghost" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
            <button className="ghost" onClick={() => void downloadReport()}>Download CSV</button>
          </div>
        </div>
        {error ? <p className="form-error">{error}</p> : null}
        {loading && !summary ? <p className="muted">Loading sales analytics…</p> : null}
        {summary ? (
          <>
            <div className="metric-grid">
              <article className="metric accent"><span>Gross sales</span><strong>{money(summary.grossSalesMinor, summary.currency)}</strong><p>period gross merchandise value</p></article>
              <article className="metric"><span>Net after commission</span><strong>{money(summary.netAfterCommissionMinor, summary.currency)}</strong><p>after commission & refunds</p></article>
              <article className="metric"><span>Refunds issued</span><strong>{money(summary.refundsMinor, summary.currency)}</strong><p>successfully refunded</p></article>
              <article className="metric"><span>Tips received</span><strong>{money(summary.tipsMinor, summary.currency)}</strong><p>from customers</p></article>
              <article className="metric"><span>Delivery fees</span><strong>{money(summary.deliveryFeesMinor, summary.currency)}</strong><p>collected</p></article>
              <article className="metric"><span>Avg order value</span><strong>{money(summary.averageOrderMinor, summary.currency)}</strong><p>across {summary.orders.received} orders</p></article>
            </div>
            <div className="two-column">
              <section className="panel">
                <div className="panel-head"><div><p className="eyebrow">ORDERS</p><h2>Order health</h2></div></div>
                <div className="metric-grid">
                  <article className="metric"><span>Received</span><strong>{summary.orders.received}</strong><p>orders in period</p></article>
                  <article className="metric"><span>Accepted</span><strong>{summary.orders.accepted}</strong><p>by the merchant</p></article>
                  <article className="metric"><span>Delivered</span><strong>{summary.orders.delivered}</strong><p>orders delivered</p></article>
                  <article className="metric"><span>Cancelled</span><strong>{summary.orders.cancelled}</strong><p>orders cancelled</p></article>
                </div>
                <dl className="detail-list">
                  <div><dt>Acceptance rate</dt><dd>{summary.orders.acceptanceRate}%</dd></div>
                  <div><dt>Avg preparation time</dt><dd>{summary.orders.avgPrepMinutes} min</dd></div>
                </dl>
              </section>
              <section className="panel">
                <div className="panel-head"><div><p className="eyebrow">CALCULATION RULES</p><h2>How the numbers are derived</h2></div></div>
                <p className="muted">Currency: {summary.currency}. Platform commission: {(summary.calculationRules.commissionRatePercent ?? 0)}% ({(summary.commissionBps / 100).toFixed(1)}%).</p>
                <dl className="detail-list">
                  <div><dt>Gross sales</dt><dd>{summary.calculationRules.grossSalesFormula}</dd></div>
                  <div><dt>Commission</dt><dd>{summary.calculationRules.commissionFormula}</dd></div>
                  <div><dt>Refunds</dt><dd>{summary.calculationRules.refundFormula}</dd></div>
                  <div><dt>Net after commission</dt><dd>{summary.calculationRules.netFormula}</dd></div>
                  <div><dt>Average order</dt><dd>{summary.calculationRules.averageOrderFormula}</dd></div>
                </dl>
              </section>
            </div>
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">COMMISSION</p><h2>Commission & net payout</h2></div></div>
        {summary ? (
          <>
            <dl className="detail-list">
              <div><dt>Gross sales</dt><dd>{money(summary.grossSalesMinor, summary.currency)}</dd></div>
              <div><dt>Platform commission</dt><dd>{(summary.calculationRules.commissionRatePercent ?? 0)}% ({(summary.commissionBps / 100).toFixed(1)}%)</dd></div>
              <div><dt>Commission amount</dt><dd>−{money(summary.commissionMinor, summary.currency)}</dd></div>
              <div><dt>Refunds</dt><dd>−{money(summary.refundsMinor, summary.currency)}</dd></div>
              <div><dt>Net after commission</dt><dd><strong>{money(summary.netAfterCommissionMinor, summary.currency)}</strong></dd></div>
            </dl>
            <p className="fine-print">Net payable = gross sales − commission − refunds. Merchants tune their commission rate from the Store & business tab.</p>
          </>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">PRODUCTS</p><h2>Product performance</h2></div></div>
        {loading && !products ? <p className="muted">Loading product performance…</p> : null}
        {products ? (
          products.items.length === 0 ? <div className="empty"><h3>No sales yet</h3><p>Product performance appears once paid orders include these items.</p></div> : (
            <div className="table-wrap"><table>
              <thead><tr><th>#</th><th>Product</th><th>Category</th><th>Qty sold</th><th>Revenue</th><th>Share</th></tr></thead>
              <tbody>
                {products.items.map((item, index) => (
                  <tr key={item.productId}>
                    <td>{index + 1}</td>
                    <td>{item.displayName}</td>
                    <td>{item.categoryLabel ?? "Uncategorised"}</td>
                    <td>{item.quantity}</td>
                    <td>{money(item.revenueMinor, products.currency)}</td>
                    <td>{item.sharePercent}%</td>
                  </tr>
                ))}
              </tbody>
            </table></div>
          )
        ) : null}
        {products && products.bestSellers.length > 0 ? (
          <div className="stack">
            <h3>Best sellers</h3>
            <div className="stack">
              {products.bestSellers.map((item) => (
                <div className="flag-row" key={item.productId}>
                  <div><strong>{item.displayName}</strong><small className="block">×{item.quantity} sold</small></div>
                  <span>{money(item.revenueMinor, products.currency)}</span>
                </div>
              ))}
            </div>
          </div>
        ) : null}
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">RATINGS</p><h2>Customer ratings & feedback</h2></div></div>
        {loading && !reviews ? <p className="muted">Loading ratings…</p> : null}
        {reviews ? (
          reviews.count === 0 ? <div className="empty"><h3>No ratings yet</h3><p>Completed orders with courier & merchant ratings will appear here.</p></div> : (
            <>
              <div className="metric-grid">
                <article className="metric accent"><span>Average rating</span><strong>{reviews.average.toFixed(1)} / 5</strong><p>{reviews.count} reviews</p></article>
              </div>
              <div className="stack">
                {[1, 2, 3, 4, 5].map((rating) => {
                  const count = Number(distribution[String(rating)] ?? distribution[String(rating)] ?? 0);
                  const width = maxRatingCount > 0 ? Math.round((count / maxRatingCount) * 100) : 0;
                  return (
                    <div key={rating} className="rating-row">
                      <span>{rating} ★</span>
                      <div className="rating-track"><span style={{ width: `${width}%` }} /></div>
                      <span>{count}</span>
                    </div>
                  );
                })}
              </div>
              <div className="stack">
                {reviews.items.map((review) => (
                  <div className="flag-row" key={review.id}>
                    <div><strong>{review.customerName ?? "Customer"}</strong><small className="block">{review.comment ?? "No comment provided."}</small><small className="block">{new Date(review.createdAt).toLocaleDateString()}</small></div>
                    <span>★ {review.merchantRating}</span>
                  </div>
                ))}
              </div>
            </>
          )
        ) : null}
      </section>
    </div>
  );
}

function Settlements() {
  const [items, setItems] = useState<Settlement[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ items: Settlement[] }>("/v1/merchant/settlements")
      .then((result) => setItems(result.items))
      .catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load settlements."));
  }, []);

  return <section className="panel">
    <div className="panel-head"><div><p className="eyebrow">PAYOUTS</p><h2>Settlement history</h2></div></div>
    {error ? <p className="form-error">{error}</p> : items === null ? <p className="muted">Loading settlements…</p> : items.length === 0 ? <div className="empty"><h3>No settlements yet</h3><p>Settlements appear after the finance team closes a payout period.</p></div> : <div className="table-wrap"><table>
      <thead><tr><th>Period</th><th>Gross</th><th>Commission</th><th>Net payable</th><th>Status</th></tr></thead>
      <tbody>{items.map((settlement) => <tr key={settlement.id}>
        <td>{new Date(settlement.periodStart).toLocaleDateString()} – {new Date(settlement.periodEnd).toLocaleDateString()}</td>
        <td>{money(settlement.grossMinor, settlement.currency)}</td>
        <td>−{money(settlement.commissionMinor, settlement.currency)}</td>
        <td><strong>{money(settlement.netPayableMinor, settlement.currency)}</strong></td>
        <td><span className={`status-text ${settlement.status.toLowerCase()}`}>{settlement.status}</span></td>
      </tr>)}</tbody>
    </table></div>}
  </section>;
}

function Finance() {
  const [settlements, setSettlements] = useState<Settlement[]>([]);
  const [ledger, setLedger] = useState<Array<{ id: string; accountCode: string; debitMinor: number; creditMinor: number; currency: string; description: string | null; occurredAt: string }>>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const s = await api<{ items: Settlement[] }>("/v1/merchant/settlements");
      setSettlements(s.items);
      try {
        const l = await api<{ items: Array<{ id: string; accountCode: string; debitMinor: number; creditMinor: number; currency: string; description: string | null; occurredAt: string }> }>("/v1/merchant/ledger?limit=50");
        setLedger(l.items ?? []);
      } catch {
        setLedger([]);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load finance data.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const totalNet = useMemo(() => settlements.reduce((sum, item) => sum + item.netPayableMinor, 0), [settlements]);

  return <section className="stack">
    <div className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">FINANCE</p><h2>Earnings & payouts</h2></div>
        <button className="ghost" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </div>
      <div className="metric-grid">
        <article className="metric accent"><span>Total net payable</span><strong>{money(totalNet)}</strong><p>{settlements.length} settlements</p></article>
        <article className="metric"><span>Paid</span><strong>{money(settlements.filter((item) => item.status === "PAID").reduce((sum, item) => sum + item.netPayableMinor, 0))}</strong><p>Completed settlements</p></article>
        <article className="metric"><span>Pending</span><strong>{money(settlements.filter((item) => item.status !== "PAID").reduce((sum, item) => sum + item.netPayableMinor, 0))}</strong><p>Awaiting payment</p></article>
      </div>
      {error ? <p className="form-error">{error}</p> : null}
    </div>
    <div className="panel table-wrap">
      <div className="panel-head"><div><p className="eyebrow">SETTLEMENTS</p><h2>Settlement history</h2></div></div>
      <table>
        <thead><tr><th>Period</th><th>Gross</th><th>Commission</th><th>Net</th><th>Status</th><th>Paid</th></tr></thead>
        <tbody>
          {settlements.map((item) => (
            <tr key={item.id}>
              <td>{new Date(item.periodStart).toLocaleDateString()} – {new Date(item.periodEnd).toLocaleDateString()}</td>
              <td>{money(item.grossMinor, item.currency)}</td>
              <td>−{money(item.commissionMinor, item.currency)}</td>
              <td><strong>{money(item.netPayableMinor, item.currency)}</strong></td>
              <td><span className={`status-text ${item.status.toLowerCase()}`}>{item.status}</span></td>
              <td>{item.paidAt ? new Date(item.paidAt).toLocaleDateString() : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {settlements.length === 0 ? <p className="empty">No settlements recorded yet.</p> : null}
    </div>
    {ledger.length > 0 ? <div className="panel table-wrap">
      <div className="panel-head"><div><p className="eyebrow">LEDGER</p><h2>Recent activity</h2></div></div>
      <table>
        <thead><tr><th>When</th><th>Account</th><th>Description</th><th>Debit</th><th>Credit</th></tr></thead>
        <tbody>
          {ledger.map((entry) => (
            <tr key={entry.id}>
              <td>{new Date(entry.occurredAt).toLocaleString()}</td>
              <td>{entry.accountCode}</td>
              <td>{entry.description ?? "—"}</td>
              <td>{entry.debitMinor ? money(entry.debitMinor, entry.currency) : "—"}</td>
              <td>{entry.creditMinor ? money(entry.creditMinor, entry.currency) : "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div> : null}
  </section>;
}

function Business({ me, reload, notify }: { me: MerchantMe; reload: () => Promise<void>; notify: (message: string) => void }) {
  const m = me.merchant;
  const [displayName, setDisplayName] = useState(m.displayName);
  const [description, setDescription] = useState(m.description ?? "");
  const [logoUrl, setLogoUrl] = useState(m.logoUrl ?? "");
  const [commissionBps, setCommissionBps] = useState(String(m.commissionBps ?? 1500));
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState(String(m.deliveryRadiusKm ?? 8));
  const [cancellationPolicy, setCancellationPolicy] = useState(m.cancellationPolicy ?? "");
  const [refundPolicy, setRefundPolicy] = useState(m.refundPolicy ?? "");
  const [saving, setSaving] = useState(false);

  const [savingLocationId, setSavingLocationId] = useState<string | null>(null);
  const [hoursDrafts, setHoursDrafts] = useState<Record<string, string>>({});

  const [documentType, setDocumentType] = useState(MERCHANT_DOCUMENT_TYPES[0]);
  const [storageKey, setStorageKey] = useState("");
  const [documents, setDocuments] = useState<MerchantDocument[] | null>(null);
  const [savingDocument, setSavingDocument] = useState(false);

  const [acceptingOrders, setAcceptingOrders] = useState(m.acceptingOrders);
  const [availabilityNote, setAvailabilityNote] = useState(m.availabilityNote ?? "");
  const [closures, setClosures] = useState<MerchantClosure[]>([]);
  const [closureLocationId, setClosureLocationId] = useState("");
  const [closureStartsAt, setClosureStartsAt] = useState("");
  const [closureEndsAt, setClosureEndsAt] = useState("");
  const [closureReason, setClosureReason] = useState("");
  const [savingAvailability, setSavingAvailability] = useState(false);

  const loadDocuments = useCallback(async () => {
    try {
      const result = await api<{ items: MerchantDocument[] }>("/v1/merchant/documents");
      setDocuments(result.items);
    } catch {
      setDocuments([]);
    }
  }, []);

  const loadClosures = useCallback(async () => {
    try {
      const result = await api<{ items: MerchantClosure[] }>("/v1/merchant/closures");
      setClosures(result.items);
    } catch {
      setClosures([]);
    }
  }, []);

  useEffect(() => { void loadDocuments(); }, [loadDocuments]);
  useEffect(() => { void loadClosures(); }, [loadClosures]);

  async function saveStore(event: React.FormEvent) {
    event.preventDefault();
    const commission = Number(commissionBps);
    const radius = Number(deliveryRadiusKm);
    if (!Number.isFinite(commission) || commission < 0 || commission > 10000) return notify("Commission must be between 0 and 10000 basis points.");
    if (!Number.isFinite(radius) || radius < 0 || radius > 200) return notify("Delivery radius must be between 0 and 200 km.");
    setSaving(true);
    try {
      await api("/v1/merchant/me", { method: "PATCH", body: JSON.stringify({
        displayName, description, logoUrl, commissionBps: commission, deliveryRadiusKm: radius,
        cancellationPolicy, refundPolicy
      }) });
      notify("Store profile, contract and commission updated.");
      await reload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the store.");
    } finally {
      setSaving(false);
    }
  }

  async function toggleLocation(location: MerchantLocation) {
    setSavingLocationId(location.id);
    try {
      await api(`/v1/merchant/locations/${location.id}`, { method: "PATCH", body: JSON.stringify({ active: !location.isActive }) });
      notify(`${location.name} is now ${location.isActive ? "closed" : "open"}.`);
      await reload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the location.");
    } finally {
      setSavingLocationId(null);
    }
  }

  async function saveLocationHours(location: MerchantLocation) {
    const raw = hoursDrafts[location.id];
    if (raw === undefined) return;
    let openingHours: Record<string, unknown>;
    try {
      openingHours = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      return notify("Opening hours must be valid JSON before saving.");
    }
    setSavingLocationId(location.id);
    try {
      await api(`/v1/merchant/locations/${location.id}/hours`, { method: "PATCH", body: JSON.stringify({ openingHours }) });
      notify(`${location.name} opening hours updated.`);
      await reload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the opening hours.");
    } finally {
      setSavingLocationId(null);
    }
  }

  async function uploadDocument(event: React.FormEvent) {
    event.preventDefault();
    if (!storageKey.trim()) return notify("Storage key is required for document uploads.");
    setSavingDocument(true);
    try {
      await api("/v1/merchant/documents", { method: "POST", body: JSON.stringify({ documentType, storageKey: storageKey.trim() }) });
      notify("Document uploaded and queued for operator review.");
      setStorageKey("");
      await loadDocuments();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not upload the document.");
    } finally {
      setSavingDocument(false);
    }
  }

  async function saveAvailability(next?: boolean) {
    const accepting = next ?? acceptingOrders;
    setSavingAvailability(true);
    try {
      const result = await api<FulfillmentSettings>("/v1/merchant/settings/availability", {
        method: "PATCH",
        body: JSON.stringify({ acceptingOrders: accepting, note: availabilityNote })
      });
      setAcceptingOrders(result.acceptingOrders);
      setAvailabilityNote(result.availabilityNote ?? "");
      notify(accepting ? "Store is accepting orders." : "New orders are paused.");
      await reload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update store availability.");
    } finally {
      setSavingAvailability(false);
    }
  }

  async function createClosure(event: React.FormEvent) {
    event.preventDefault();
    if (!closureStartsAt || !closureEndsAt) return notify("Choose the closure start and end times.");
    try {
      await api("/v1/merchant/closures", {
        method: "POST",
        body: JSON.stringify({
          locationId: closureLocationId || undefined,
          startsAt: new Date(closureStartsAt).toISOString(),
          endsAt: new Date(closureEndsAt).toISOString(),
          reason: closureReason
        })
      });
      notify("Temporary closure scheduled.");
      setClosureStartsAt(""); setClosureEndsAt(""); setClosureReason("");
      await loadClosures();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not schedule the closure.");
    }
  }

  async function deleteClosure(closureId: string) {
    try {
      await api(`/v1/merchant/closures/${closureId}`, { method: "DELETE" });
      notify("Closure removed.");
      await loadClosures();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not remove the closure.");
    }
  }

  const canManageSettings = me.membership.role === "owner" || me.membership.permissions.includes("settings:manage");

  return <div className="stack">
    <section className="panel">
      <div className="panel-head">
        <div><p className="eyebrow">ONBOARDING</p><h2>Application & status</h2></div>
        <span className={`status-pill ${m.status}`}>{m.status}</span>
      </div>
      <dl className="detail-list">
        <div><dt>Application status</dt><dd>{m.status}</dd></div>
        <div><dt>Commission</dt><dd>{(m.commissionBps / 100).toFixed(1)}%</dd></div>
        <div><dt>Delivery radius</dt><dd>{m.deliveryRadiusKm} km</dd></div>
        <div><dt>Schedule lead window</dt><dd>{m.minScheduleLeadMinutes} min · max {m.maxScheduleDays} days</dd></div>
      </dl>
      {m.rejectionReason ? <p className="form-error">Rejection reason: {m.rejectionReason}</p> : null}
      {m.suspensionReason ? <p className="form-error">Suspension reason: {m.suspensionReason}</p> : null}
      {m.status === "pending" ? <p className="fine-print">Operators review applications and verification documents. No fulfilment actions should be taken before approval.</p> : null}
    </section>

    <section className="panel stack">
      <div className="panel-head"><div><p className="eyebrow">STORE</p><h2>Merchant profile, contract & commission</h2></div></div>
      {!canManageSettings ? <p className="muted">Your role ({me.membership.role}) can view store settings. Only owners and managers can change the profile, contract or commission.</p> : <form className="stack" onSubmit={saveStore}>
        <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={120} required /></label>
        <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={2000} /></label>
        <label>Logo URL<input value={logoUrl} onChange={(event) => setLogoUrl(event.target.value)} maxLength={500} placeholder="https://cdn.example.com/logo.png" /></label>
        <div className="form-grid">
          <label>Commission (bps)<input type="number" min={0} max={10000} value={commissionBps} onChange={(event) => setCommissionBps(event.target.value)} /></label>
          <label>Delivery radius (km)<input type="number" min={0} max={200} value={deliveryRadiusKm} onChange={(event) => setDeliveryRadiusKm(event.target.value)} /></label>
        </div>
        <label>Cancellation policy<textarea value={cancellationPolicy} onChange={(event) => setCancellationPolicy(event.target.value)} rows={3} maxLength={1000} placeholder="Free cancellation within 2 minutes of ordering." /></label>
        <label>Refund policy<textarea value={refundPolicy} onChange={(event) => setRefundPolicy(event.target.value)} rows={3} maxLength={1000} placeholder="Refunds return to the original payment method within 5 business days." /></label>
        <button disabled={saving}>{saving ? "Saving…" : "Save store profile"}</button>
      </form>}
    </section>

    <section className="panel stack">
      <div className="panel-head"><div><p className="eyebrow">STORE</p><h2>Locations, hours & coverage</h2></div></div>
      {me.locations.length === 0 ? <p className="muted">No locations have been configured yet.</p> : <div className="location-list">
        {me.locations.map((location) => (
          <article key={location.id} className="location-row">
            <div>
              <strong>{location.name}</strong>
              <p>{location.addressLine}</p>
              <div className="stack" style={{ gap: "0.5rem", marginTop: "0.5rem" }}>
                <div className="inline-form">
                  <label className="stack" style={{ gap: "0.3rem" }}><span>Opening hours (JSON)</span>
                    <textarea rows={4} value={hoursDrafts[location.id] ?? JSON.stringify(location.openingHours ?? {}, null, 2)} onChange={(event) => setHoursDrafts((current) => ({ ...current, [location.id]: event.target.value }))} />
                  </label>
                  <button className="ghost" disabled={savingLocationId === location.id} onClick={() => void saveLocationHours(location)}>Save hours</button>
                </div>
              </div>
            </div>
            <button className={location.isActive ? "toggle on" : "toggle"} disabled={savingLocationId === location.id} onClick={() => void toggleLocation(location)}>
              {savingLocationId === location.id ? "Saving…" : location.isActive ? "Open" : "Closed"}
            </button>
          </article>
        ))}
      </div>}
      <p className="fine-print">Opening hours use the weekly window JSON accepted by the platform, for example {`{ "mon": { "open": "08:00", "close": "17:00" }, "default": { "closed": true } }`}. Closed days and temporary closures use the <code>closed</code> flag.</p>
    </section>

    <section className="panel stack">
      <div className="panel-head">
        <div><p className="eyebrow">AVAILABILITY</p><h2>Order intake & temporary closures</h2></div>
        <span className={`status-pill ${acceptingOrders ? "active" : "suspended"}`}>{acceptingOrders ? "Accepting orders" : "Paused"}</span>
      </div>
      <label className="check-row">
        <input type="checkbox" checked={acceptingOrders} disabled={!canManageSettings || savingAvailability} onChange={(event) => { setAcceptingOrders(event.target.checked); void saveAvailability(event.target.checked); }} />
        Accept new orders
      </label>
      <label>Availability note (shown to customers when paused)
        <input value={availabilityNote} onChange={(event) => setAvailabilityNote(event.target.value)} maxLength={300} placeholder="Kitchen is closed for maintenance until 4 PM." disabled={!canManageSettings} />
      </label>
      {canManageSettings ? <button className="ghost" disabled={savingAvailability} onClick={() => void saveAvailability()}>{savingAvailability ? "Saving…" : "Save availability note"}</button> : null}
      <div className="panel-head"><div><h3>Scheduled closures</h3></div></div>
      {closures.length === 0 ? <p className="muted">No upcoming closures.</p> : <div className="stack">{closures.map((closure) => <div className="flag-row" key={closure.id}>
        <div><strong>{closure.locationName ?? "All locations"}</strong><p>{new Date(closure.startsAt).toLocaleString()} → {new Date(closure.endsAt).toLocaleString()}{closure.reason ? ` · ${closure.reason}` : ""}</p></div>
        {canManageSettings ? <button className="ghost danger" onClick={() => void deleteClosure(closure.id)}>Remove</button> : null}
      </div>)}</div>}
      {canManageSettings ? <form className="stack" onSubmit={createClosure}>
        <div className="form-grid">
          <label>Location<select value={closureLocationId} onChange={(event) => setClosureLocationId(event.target.value)}><option value="">All locations</option>{me.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label>
          <label>Reason<input value={closureReason} onChange={(event) => setClosureReason(event.target.value)} maxLength={300} placeholder="Public holiday" /></label>
          <label>Starts<input type="datetime-local" value={closureStartsAt} onChange={(event) => setClosureStartsAt(event.target.value)} required /></label>
          <label>Ends<input type="datetime-local" value={closureEndsAt} onChange={(event) => setClosureEndsAt(event.target.value)} required /></label>
        </div>
        <button>Schedule closure</button>
      </form> : null}
    </section>

    <section className="panel stack">
      <div className="panel-head"><div><p className="eyebrow">VERIFICATION</p><h2>Business documents</h2></div></div>
      {documents === null ? <p className="muted">Loading documents…</p> : documents.length === 0 ? <p className="muted">No documents uploaded yet.</p> : <div className="stack">
        {documents.map((document) => <div className="flag-row" key={document.id}>
          <div>
            <strong>{document.documentType.replaceAll("_", " ")}</strong>
            <p><small className="block">{document.storageKey}</small>{document.reviewNotes ? <small className="block">Review: {document.reviewNotes}</small> : null}</p>
          </div>
          <span className={`status-pill ${document.status}`}>{document.status}</span>
        </div>)}
      </div>}
      <form className="stack" onSubmit={uploadDocument}>
        <div className="form-grid">
          <label>Document type
            <select value={documentType} onChange={(event) => setDocumentType(event.target.value)}>
              {MERCHANT_DOCUMENT_TYPES.map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}
            </select>
          </label>
          <label>Storage key<input value={storageKey} onChange={(event) => setStorageKey(event.target.value)} placeholder="merchants/<merchant-id>/business_registration.pdf" required /></label>
        </div>
        <button disabled={savingDocument}>{savingDocument ? "Uploading…" : "Upload for review"}</button>
      </form>
    </section>
  </div>;
}

type MemberDraft = { role: "manager" | "staff"; permissions: string[]; isActive: boolean };

function ControlCenter({ me, notify }: { me: MerchantMe; notify: (message: string) => void }) {
  const canManageStaff = me.membership.role === "owner" || me.membership.permissions.includes("staff:manage");
  const canManageSettings = me.membership.role === "owner" || me.membership.permissions.includes("settings:manage");
  const canViewAudit = me.membership.role === "owner" || me.membership.permissions.includes("audit:view");
  const [members, setMembers] = useState<MerchantMember[]>([]);
  const [invitations, setInvitations] = useState<StaffInvitation[]>([]);
  const [drafts, setDrafts] = useState<Record<string, MemberDraft>>({});
  const [fulfillment, setFulfillment] = useState<FulfillmentSettings | null>(null);
  const [preferences, setPreferences] = useState<NotificationPreferences | null>(null);
  const [tickets, setTickets] = useState<SupportTicket[]>([]);
  const [ticketDetail, setTicketDetail] = useState<SupportTicketDetail | null>(null);
  const [sessions, setSessions] = useState<UserSession[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<"manager" | "staff">("staff");
  const [invitePermissions, setInvitePermissions] = useState<string[]>([]);
  const [ticketSubject, setTicketSubject] = useState("");
  const [ticketMessage, setTicketMessage] = useState("");
  const [reply, setReply] = useState("");
  const [loading, setLoading] = useState(true);

  const openTicket = useCallback(async (ticketId: string) => {
    try {
      setTicketDetail(await api<SupportTicketDetail>(`/v1/merchant/support/tickets/${ticketId}`));
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not load the support ticket.");
    }
  }, [notify]);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [staffResult, fulfillmentResult, preferenceResult, ticketResult, sessionResult, auditResult] = await Promise.all([
        canManageStaff ? api<{ items: MerchantMember[]; invitations: StaffInvitation[] }>("/v1/merchant/staff") : Promise.resolve({ items: [], invitations: [] }),
        optional(api<FulfillmentSettings>("/v1/merchant/settings/fulfillment"), null),
        optional(api<NotificationPreferences>("/v1/notifications/preferences"), null),
        optional(api<{ items: SupportTicket[] }>("/v1/merchant/support/tickets"), { items: [] }),
        optional(api<{ items: UserSession[] }>("/v1/users/me/sessions"), { items: [] }),
        canViewAudit ? optional(api<{ items: AuditEntry[] }>("/v1/merchant/audit-log"), { items: [] }) : Promise.resolve({ items: [] })
      ]);
      setMembers(staffResult.items);
      setInvitations(staffResult.invitations);
      setDrafts(Object.fromEntries(staffResult.items.filter((member) => member.role !== "owner").map((member) => [member.userId, {
        role: member.role as "manager" | "staff", permissions: member.permissions, isActive: member.isActive
      }])));
      setFulfillment(fulfillmentResult);
      setPreferences(preferenceResult);
      setTickets(ticketResult.items);
      setSessions(sessionResult.items);
      setAudit(auditResult.items);
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not load control center.");
    } finally { setLoading(false); }
  }, [canManageStaff, canViewAudit, notify]);

  useEffect(() => { void load(); }, [load]);

  function updateDraft(userId: string, patch: Partial<MemberDraft>) {
    setDrafts((current) => {
      const existing = current[userId];
      if (!existing) return current;
      return { ...current, [userId]: { ...existing, ...patch } };
    });
  }

  async function inviteMember(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/v1/merchant/staff/invitations", {
        method: "POST",
        body: JSON.stringify({ phoneE164: phone.trim(), role, permissions: invitePermissions.length > 0 ? invitePermissions : undefined })
      });
      notify("Staff invitation sent.");
      setPhone(""); setInvitePermissions([]);
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Could not invite the staff member."); }
  }

  async function saveMember(userId: string) {
    const draft = drafts[userId];
    if (!draft) return;
    try {
      await api(`/v1/merchant/staff/${userId}`, { method: "PATCH", body: JSON.stringify(draft) });
      notify("Staff access updated.");
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Could not update staff access."); }
  }

  async function removeMember(userId: string) {
    try { await api(`/v1/merchant/staff/${userId}`, { method: "DELETE" }); notify("Staff access revoked."); await load(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not revoke staff access."); }
  }

  async function revokeInvitation(invitationId: string) {
    try { await api(`/v1/merchant/staff/invitations/${invitationId}/revoke`, { method: "POST" }); notify("Invitation revoked."); await load(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not revoke the invitation."); }
  }

  async function saveFulfillment(event: React.FormEvent) {
    event.preventDefault();
    if (!fulfillment) return;
    try {
      setFulfillment(await api<FulfillmentSettings>("/v1/merchant/settings/fulfillment", { method: "PATCH", body: JSON.stringify(fulfillment) }));
      notify("Fulfillment settings updated.");
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Could not update fulfillment settings."); }
  }

  async function savePreferences(event: React.FormEvent) {
    event.preventDefault();
    if (!preferences) return;
    try { await api("/v1/notifications/preferences", { method: "PATCH", body: JSON.stringify(preferences) }); notify("Notification preferences saved."); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not save notification preferences."); }
  }

  async function createTicket(event: React.FormEvent) {
    event.preventDefault();
    try {
      const created = await api<{ id: string }>("/v1/merchant/support/tickets", {
        method: "POST",
        body: JSON.stringify({ subject: ticketSubject, message: ticketMessage, category: "merchant_operations", priority: "NORMAL" })
      });
      notify("Support ticket opened.");
      setTicketSubject(""); setTicketMessage("");
      await load();
      await openTicket(created.id);
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Could not open support ticket."); }
  }

  async function sendReply(event: React.FormEvent) {
    event.preventDefault();
    if (!ticketDetail || !reply.trim()) return;
    try {
      await api(`/v1/merchant/support/tickets/${ticketDetail.id}/messages`, { method: "POST", body: JSON.stringify({ body: reply.trim() }) });
      notify("Reply sent.");
      setReply("");
      await openTicket(ticketDetail.id);
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Could not send reply."); }
  }

  async function setTicketStatus(status: "OPEN" | "IN_PROGRESS" | "RESOLVED" | "CLOSED") {
    if (!ticketDetail) return;
    try {
      await api(`/v1/merchant/support/tickets/${ticketDetail.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(`Ticket marked ${status.replace("_", " ").toLowerCase()}.`);
      await openTicket(ticketDetail.id);
      await load();
    } catch (cause) { notify(cause instanceof Error ? cause.message : "Could not update the ticket."); }
  }

  async function revokeSession(sessionId: string) {
    try { await api(`/v1/users/me/sessions/${sessionId}/revoke`, { method: "POST" }); notify("Session revoked."); await load(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not revoke session."); }
  }

  async function revokeOthers() {
    try { await api("/v1/users/me/sessions/revoke-others", { method: "POST" }); notify("Other sessions revoked."); await load(); }
    catch (cause) { notify(cause instanceof Error ? cause.message : "Could not revoke other sessions."); }
  }

  return <div className="stack">
    {loading ? <div className="panel empty">Loading control center…</div> : null}
    <div className="two-column">
      <section className="panel stack">
        <div className="panel-head"><div><p className="eyebrow">ACCESS</p><h2>Staff accounts</h2></div><span className="status-pill active">{members.length} members</span></div>
        {canManageStaff ? <form className="stack" onSubmit={inviteMember}>
          <div className="inline-form">
            <input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+251911000001" pattern="\+[1-9]\d{7,14}" required />
            <select value={role} onChange={(event) => setRole(event.target.value as "manager" | "staff")}><option value="staff">Limited staff</option><option value="manager">Manager</option></select>
            <button>Invite</button>
          </div>
          <PermissionPicker value={invitePermissions} onChange={setInvitePermissions} />
          <p className="fine-print">Leave permissions empty to use the role defaults. Existing users are linked immediately; new users are linked after they verify their phone.</p>
        </form> : <p className="muted">Your role can view staff but cannot change access.</p>}
        <div className="stack">{members.map((member) => {
          const draft = drafts[member.userId];
          return <div className="flag-row" key={member.userId}>
            <div className="stack" style={{ gap: "0.4rem", flex: 1 }}>
              <div><strong>{member.displayName ?? member.phoneE164}</strong><p>{member.phoneE164} · {member.activeSessions} active sessions</p></div>
              {canManageStaff && member.role !== "owner" && draft ? <>
                <div className="inline-form">
                  <select value={draft.role} onChange={(event) => {
                    const nextRole = event.target.value as "manager" | "staff";
                    updateDraft(member.userId, { role: nextRole, permissions: defaultPermissions(nextRole) });
                  }}><option value="staff">Limited staff</option><option value="manager">Manager</option></select>
                  <label className="check-row"><input type="checkbox" checked={draft.isActive} onChange={(event) => updateDraft(member.userId, { isActive: event.target.checked })} /> Active</label>
                </div>
                <PermissionPicker value={draft.permissions} onChange={(permissions) => updateDraft(member.userId, { permissions })} />
                <div className="toolbar-inline"><button className="ghost" onClick={() => void saveMember(member.userId)}>Save access</button><button className="ghost danger" onClick={() => void removeMember(member.userId)}>Remove</button></div>
              </> : <span className="status-text">{member.role}{member.isActive ? "" : " · deactivated"}</span>}
            </div>
            {member.role === "owner" ? <span className="status-pill active">Owner</span> : null}
          </div>;
        })}</div>
        {invitations.length > 0 ? <>
          <div className="panel-head"><div><h3>Pending invitations</h3></div></div>
          {invitations.map((invitation) => <div className="flag-row" key={invitation.id}>
            <div><strong>{invitation.phoneE164}</strong><p>{invitation.role} · expires {new Date(invitation.expiresAt).toLocaleDateString()} · invited by {invitation.invitedByName ?? "merchant"}</p></div>
            {canManageStaff ? <button className="ghost danger" onClick={() => void revokeInvitation(invitation.id)}>Revoke</button> : null}
          </div>)}
        </> : null}
      </section>
      <section className="panel stack">
        <div className="panel-head"><div><p className="eyebrow">FULFILLMENT</p><h2>How customers receive orders</h2></div></div>
        {fulfillment ? <form className="stack" onSubmit={saveFulfillment}>
          <label className="check-row"><input type="checkbox" checked={fulfillment.supportsDelivery} disabled={!canManageSettings} onChange={(event) => setFulfillment({ ...fulfillment, supportsDelivery: event.target.checked })} /> Offer delivery</label>
          <label className="check-row"><input type="checkbox" checked={fulfillment.supportsPickup} disabled={!canManageSettings} onChange={(event) => setFulfillment({ ...fulfillment, supportsPickup: event.target.checked })} /> Offer customer pickup</label>
          <label className="check-row"><input type="checkbox" checked={fulfillment.allowsScheduling} disabled={!canManageSettings} onChange={(event) => setFulfillment({ ...fulfillment, allowsScheduling: event.target.checked })} /> Accept scheduled orders</label>
          <div className="form-grid">
            <label>Minimum lead (minutes)<input type="number" min={0} max={10080} value={fulfillment.minScheduleLeadMinutes} disabled={!canManageSettings} onChange={(event) => setFulfillment({ ...fulfillment, minScheduleLeadMinutes: Number(event.target.value) })} /></label>
            <label>Maximum days ahead<input type="number" min={0} max={30} value={fulfillment.maxScheduleDays} disabled={!canManageSettings} onChange={(event) => setFulfillment({ ...fulfillment, maxScheduleDays: Number(event.target.value) })} /></label>
          </div>
          <label>Pickup instructions<textarea value={fulfillment.pickupInstructions ?? ""} disabled={!canManageSettings} onChange={(event) => setFulfillment({ ...fulfillment, pickupInstructions: event.target.value })} rows={3} maxLength={1000} placeholder="Where should customers collect their order?" /></label>
          {canManageSettings ? <button>Save fulfillment settings</button> : <p className="muted">Your role can view fulfillment settings.</p>}
        </form> : <p className="muted">Loading fulfillment settings…</p>}
      </section>
    </div>

    <div className="two-column">
      <section className="panel stack"><div className="panel-head"><div><p className="eyebrow">NOTIFICATIONS</p><h2>Operational alerts</h2></div></div>{preferences ? <form className="stack" onSubmit={savePreferences}>{(["pushEnabled", "smsEnabled", "emailEnabled", "orderUpdates", "promotions", "securityAlerts"] as const).map((key) => <label className="check-row" key={key}><input type="checkbox" checked={preferences[key]} onChange={(event) => setPreferences({ ...preferences, [key]: event.target.checked })} /> {key.replace(/([A-Z])/g, " $1")}</label>)}<button>Save notification preferences</button></form> : <p className="muted">Loading notification preferences…</p>}</section>
      <section className="panel stack"><div className="panel-head"><div><p className="eyebrow">SUPPORT</p><h2>Platform support</h2></div></div><form className="stack" onSubmit={createTicket}><label>Subject<input value={ticketSubject} onChange={(event) => setTicketSubject(event.target.value)} minLength={3} maxLength={160} required /></label><label>Message<textarea value={ticketMessage} onChange={(event) => setTicketMessage(event.target.value)} rows={3} maxLength={4000} required /></label><button>Open ticket</button></form><div className="stack">{tickets.map((ticket) => <button className="ticket-row" key={ticket.id} onClick={() => void openTicket(ticket.id)}><span><strong>{ticket.subject}</strong><small>{ticket.category} · {ticket.messageCount} messages</small></span><span className="status-text">{ticket.status}</span></button>)}</div>
      {ticketDetail ? <div className="stack">
        <div className="panel-head"><div><h3>{ticketDetail.subject}</h3><p>{ticketDetail.requesterName ?? "Merchant"} · {ticketDetail.priority}</p></div><span className="status-pill">{ticketDetail.status}</span></div>
        <div className="stack">{ticketDetail.messages.map((message) => <div className="flag-row" key={message.id}><div><p>{message.body}</p><small>{new Date(message.createdAt).toLocaleString()}</small></div></div>)}</div>
        <div className="toolbar-inline">{(["OPEN", "IN_PROGRESS", "RESOLVED", "CLOSED"] as const).map((status) => <button key={status} className="ghost" disabled={ticketDetail.status === status} onClick={() => void setTicketStatus(status)}>{status.replace("_", " ")}</button>)}</div>
        <form className="inline-form" onSubmit={sendReply}><input value={reply} onChange={(event) => setReply(event.target.value)} placeholder="Reply to support" maxLength={4000} required /><button>Send</button></form>
      </div> : null}
      </section>
    </div>

    <div className="two-column">
      <section className="panel stack"><div className="panel-head"><div><p className="eyebrow">SECURITY</p><h2>Active sessions</h2></div><button className="ghost" onClick={() => void revokeOthers()}>Revoke others</button></div>{sessions.map((item) => <div className="flag-row" key={item.id}><div><strong>{item.isCurrent ? "This device" : item.userAgent ?? "Unknown device"}</strong><p>Created {new Date(item.createdAt).toLocaleString()} · expires {new Date(item.expiresAt).toLocaleDateString()}</p></div>{item.isCurrent ? <span className="status-text active">Current</span> : <button className="ghost danger" onClick={() => void revokeSession(item.id)}>Revoke</button>}</div>)}</section>
      <section className="panel stack"><div className="panel-head"><div><p className="eyebrow">AUDIT</p><h2>Important changes</h2></div></div>{!canViewAudit ? <p className="muted">Your role does not include audit access.</p> : audit.length === 0 ? <p className="muted">No merchant changes recorded yet.</p> : <div className="table-wrap"><table><thead><tr><th>When</th><th>Actor</th><th>Action</th></tr></thead><tbody>{audit.map((entry) => <tr key={entry.id}><td>{new Date(entry.createdAt).toLocaleString()}</td><td>{entry.actorName ?? entry.actorUserId}</td><td>{entry.action.replace("merchant.", "")}</td></tr>)}</tbody></table></div>}</section>
    </div>
  </div>;
}

function PermissionPicker({ value, onChange }: { value: string[]; onChange: (value: string[]) => void }) {
  return <div className="form-grid">
    {MERCHANT_PERMISSIONS.map((permission) => <label className="check-row" key={permission}>
      <input
        type="checkbox"
        checked={value.includes(permission)}
        onChange={(event) => onChange(event.target.checked
          ? [...value, permission]
          : value.filter((item) => item !== permission))}
      />
      {permission.replace(":", " ")}
    </label>)}
  </div>;
}

async function optional<T>(promise: Promise<T>, fallback: T): Promise<T> {
  try { return await promise; } catch { return fallback; }
}
