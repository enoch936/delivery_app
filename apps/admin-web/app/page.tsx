"use client";

import { useCallback, useEffect, useState, type FormEvent } from "react";
import {
  api, downloadCsv, loadSession, logout, money, requestOtp, saveSession, shortDate,
  verifyOtp, type Session
} from "../lib/api";

type Dashboard = {
  ordersToday: number; gmvTodayMinor: number; activeOrders: number; onlineCouriers: number;
  pendingMerchants: number; pendingCouriers: number; openTickets: number; pendingRefunds: number;
  deliveriesToday: number; newUsersToday: number;
};
type DailyRow = { day: string; orders: number; delivered: number; gmvMinor: number };
type Summary = {
  orders: number; delivered: number; cancelled: number; gmvMinor: number; deliveryFeesMinor: number;
  tipsMinor: number; commissionMinor: number; refundedMinor: number; newUsers: number;
  averageOrderMinor: number; averageDeliveryMinutes: number;
};
type Finance = {
  payments: { provider: string; status: string; count: number; totalMinor: number }[];
  refunds: { status: string; count: number; totalMinor: number }[];
  ledgerBalances: { accountCode: string; accountType: string; debitMinor: number; creditMinor: number; netMinor: number }[];
};
type OrderRow = {
  id: string; orderNumber: string; status: string; paymentStatus: string; totalMinor: number;
  currency: string; merchantName: string; customerPhone: string | null; courierPhone: string | null;
  createdAt: string; deliveredAt: string | null;
};
type MerchantRow = {
  id: string; slug: string; displayName: string; status: string; rating: number; ratingCount: number;
  orderCount: number; ownerPhone: string | null; createdAt: string;
};
type CourierRow = {
  userId: string; status: string; fullName: string | null; phoneE164: string | null; vehicleType: string | null;
  vehiclePlate: string | null; rating: number; completedDeliveries: number; rejectionReason: string | null;
  isOnline: boolean; pendingDocuments: number; createdAt: string;
};
type DocumentRow = {
  id: string; document_type: string; storage_key: string; status: string;
  review_notes: string | null; reviewed_at: string | null; created_at: string;
};
type UserRow = {
  id: string; phoneE164: string | null; email: string | null; displayName: string | null;
  accountStatus: string; roles: string[]; createdAt: string;
};
type FlagRow = { key: string; description: string; enabled: boolean; updatedAt: string };
type ZoneRow = {
  id: string; slug: string; displayName: string; isActive: boolean;
  citySlug: string; cityName: string; boundary: unknown; operatingHours: unknown;
};
type AuditRow = {
  id: string; actorUserId: string | null; action: string; entityType: string; entityId: string | null;
  requestId: string | null; metadata: unknown; createdAt: string;
};

const TABS = [
  ["overview", "Overview"], ["orders", "Orders & reports"], ["merchants", "Merchants"],
  ["couriers", "Couriers"], ["users", "Users"], ["config", "Configuration"], ["audit", "Audit trail"]
] as const;
type Tab = (typeof TABS)[number][0];

const ROLES = ["customer", "courier", "merchant_staff", "admin", "support", "operations", "finance", "business_admin"];
const USER_STATUSES = ["active", "suspended", "disabled", "pending", "deletion_requested"];

function inputDate(daysAgo = 0): string {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return date.toISOString().slice(0, 10);
}

function queryRange(from: string, to: string): string {
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  end.setDate(end.getDate() + 1);
  return `from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`;
}

export default function AdminHome() {
  const [session, setSession] = useState<Session | null>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    setSession(loadSession());
    setReady(true);
  }, []);

  if (!ready) return <div className="boot">Loading operations console…</div>;
  if (!session) return <Login onSignedIn={setSession} />;
  return <Console session={session} onSignedOut={() => { saveSession(null); setSession(null); }} />;
}

function Login({ onSignedIn }: { onSignedIn: (session: Session) => void }) {
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState("");
  const [challengeId, setChallengeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function sendCode(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      const challenge = await requestOtp(phone.trim());
      setChallengeId(challenge.challengeId);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not send the code.");
    } finally { setBusy(false); }
  }

  async function signIn(event: FormEvent) {
    event.preventDefault();
    setBusy(true); setError("");
    try {
      onSignedIn(await verifyOtp(phone.trim(), code.trim(), challengeId));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not verify the code.");
    } finally { setBusy(false); }
  }

  return <main className="login-shell">
    <section className="login-copy">
      <p className="eyebrow">DELIVERY_APP / OPERATIONS</p>
      <h1>Run the city, calmly.</h1>
      <p className="lede">A single console for the orders, couriers, merchants and money that keep delivery moving.</p>
      <div className="login-facts">
        <p><span>01</span> Review courier documents and approvals</p>
        <p><span>02</span> Trace orders, refunds and settlement exposure</p>
        <p><span>03</span> Change service zones and feature flags safely</p>
      </div>
    </section>
    <section className="login-card">
      <p className="eyebrow">STAFF ACCESS</p>
      <h2>{challengeId ? "Enter the one-time code." : "Sign in with your work phone."}</h2>
      {!challengeId ? <form onSubmit={sendCode}>
        <label>Phone number<input value={phone} onChange={(event) => setPhone(event.target.value)} placeholder="+2519XXXXXXXX" autoComplete="tel" required /></label>
        {error && <p className="form-error">{error}</p>}
        <button disabled={busy}>{busy ? "Sending…" : "Send sign-in code"}</button>
        <p className="fine-print">Use the E.164 phone number attached to your staff account. Access is limited by role.</p>
      </form> : <form onSubmit={signIn}>
        <label>One-time code<input value={code} onChange={(event) => setCode(event.target.value)} inputMode="numeric" autoComplete="one-time-code" placeholder="123456" required autoFocus /></label>
        {error && <p className="form-error">{error}</p>}
        <button disabled={busy}>{busy ? "Verifying…" : "Enter operations console"}</button>
        <button type="button" className="link-button" onClick={() => { setChallengeId(""); setCode(""); setError(""); }}>Use a different number</button>
      </form>}
    </section>
  </main>;
}

function Console({ session, onSignedOut }: { session: Session; onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>("overview");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [from, setFrom] = useState(inputDate(29));
  const [to, setTo] = useState(inputDate());
  const [statusFilter, setStatusFilter] = useState("");
  const [search, setSearch] = useState("");
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [daily, setDaily] = useState<DailyRow[]>([]);
  const [summary, setSummary] = useState<Summary | null>(null);
  const [finance, setFinance] = useState<Finance | null>(null);
  const [orders, setOrders] = useState<OrderRow[]>([]);
  const [merchants, setMerchants] = useState<MerchantRow[]>([]);
  const [couriers, setCouriers] = useState<CourierRow[]>([]);
  const [users, setUsers] = useState<UserRow[]>([]);
  const [flags, setFlags] = useState<FlagRow[]>([]);
  const [zones, setZones] = useState<ZoneRow[]>([]);
  const [audit, setAudit] = useState<AuditRow[]>([]);
  const [documents, setDocuments] = useState<{ courier: CourierRow; items: DocumentRow[] } | null>(null);
  const [editingUser, setEditingUser] = useState<UserRow | null>(null);
  const [draftRoles, setDraftRoles] = useState<string[]>([]);
  const [pricing, setPricing] = useState({
    baseDeliveryFeeMinor: 0, perKmFeeMinor: 0, minimumDeliveryFeeMinor: 0,
    maximumDeliveryFeeMinor: 0, serviceFeeMinor: 0, nightSurchargeMinor: 0,
    commissionBps: 1500, currency: "ETB"
  });

  function notify(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 4000);
  }

  const load = useCallback(async () => {
    setLoading(true); setError("");
    try {
      if (tab === "overview") {
        const range = queryRange(from, to);
        const [dash, days, fin] = await Promise.all([
          api<Dashboard>("/v1/admin/dashboard"),
          api<{ items: DailyRow[] }>(`/v1/admin/reports/daily?${range}`),
          api<Finance>(`/v1/admin/reports/finance?${range}`)
        ]);
        setDashboard(dash); setDaily(days.items); setFinance(fin);
      } else if (tab === "orders") {
        const range = queryRange(from, to);
        const status = statusFilter ? `&status=${encodeURIComponent(statusFilter)}` : "";
        const [sum, rows] = await Promise.all([
          api<Summary>(`/v1/admin/reports/summary?${range}`),
          api<{ items: OrderRow[] }>(`/v1/admin/reports/orders?${range}${status}&limit=100`)
        ]);
        setSummary(sum); setOrders(rows.items);
      } else if (tab === "merchants") {
        const status = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
        setMerchants((await api<{ items: MerchantRow[] }>(`/v1/admin/merchants${status}`)).items);
      } else if (tab === "couriers") {
        const status = statusFilter ? `?status=${encodeURIComponent(statusFilter)}` : "";
        setCouriers((await api<{ items: CourierRow[] }>(`/v1/admin/couriers${status}`)).items);
      } else if (tab === "users") {
        const term = search ? `?search=${encodeURIComponent(search)}` : "";
        setUsers((await api<{ items: UserRow[] }>(`/v1/admin/users${term}`)).items);
      } else if (tab === "config") {
        const [flagResult, zoneResult] = await Promise.all([
          api<{ items: FlagRow[] }>("/v1/admin/feature-flags"),
          api<{ items: ZoneRow[] }>("/v1/admin/zones")
        ]);
        setFlags(flagResult.items); setZones(zoneResult.items);
      } else {
        setAudit((await api<{ items: AuditRow[] }>("/v1/admin/audit-log")).items);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load this view.");
    } finally { setLoading(false); }
  }, [tab, from, to, statusFilter, search]);

  useEffect(() => { void load(); }, [load]);

  async function setMerchantStatus(merchant: MerchantRow, status: "active" | "suspended" | "closed") {
    try {
      await api(`/v1/admin/merchants/${merchant.id}/status`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(`${merchant.displayName} is now ${status}.`); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update merchant."); }
  }

  async function reviewCourier(courier: CourierRow, decision: "approve" | "reject" | "suspend") {
    try {
      await api(`/v1/admin/couriers/${courier.userId}/review`, { method: "POST", body: JSON.stringify({ decision }) });
      notify(`${courier.fullName ?? "Courier"} ${decision === "approve" ? "approved" : decision === "reject" ? "rejected" : "suspended"}.`);
      setDocuments(null); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review courier."); }
  }

  async function openDocuments(courier: CourierRow) {
    try {
      const result = await api<{ items: DocumentRow[] }>(`/v1/admin/couriers/${courier.userId}/documents`);
      setDocuments({ courier, items: result.items });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not load documents."); }
  }

  async function reviewDocument(document: DocumentRow, status: "approved" | "rejected") {
    try {
      await api(`/v1/admin/courier-documents/${document.id}/review`, { method: "PATCH", body: JSON.stringify({ status }) });
      notify(`Document ${status}.`);
      if (documents) await openDocuments(documents.courier);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not review document."); }
  }

  async function setUserStatus(user: UserRow, accountStatus: string) {
    try {
      await api(`/v1/admin/users/${user.id}/status`, { method: "PATCH", body: JSON.stringify({ accountStatus }) });
      notify(`${user.displayName ?? user.phoneE164 ?? "User"} is now ${accountStatus}.`); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update user."); }
  }

  async function saveRoles() {
    if (!editingUser) return;
    try {
      await api(`/v1/admin/users/${editingUser.id}/roles`, { method: "PATCH", body: JSON.stringify({ roles: draftRoles }) });
      notify("Roles updated."); setEditingUser(null); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update roles."); }
  }

  async function toggleFlag(flag: FlagRow) {
    try {
      await api(`/v1/admin/feature-flags/${encodeURIComponent(flag.key)}`, { method: "PATCH", body: JSON.stringify({ enabled: !flag.enabled }) });
      notify(`${flag.key} ${flag.enabled ? "disabled" : "enabled"}.`); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update flag."); }
  }

  async function toggleZone(zone: ZoneRow) {
    try {
      await api(`/v1/admin/zones/${zone.id}/active`, { method: "PATCH", body: JSON.stringify({ isActive: !zone.isActive }) });
      notify(`${zone.displayName} ${zone.isActive ? "paused" : "activated"}.`); void load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not update zone."); }
  }

  async function savePricing(event: FormEvent) {
    event.preventDefault();
    try {
      await api("/v1/admin/pricing-rules", { method: "PUT", body: JSON.stringify({ ...pricing, serviceCategorySlug: null }) });
      notify("New pricing rule published.");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not publish pricing."); }
  }

  async function exportOrders() {
    try {
      await downloadCsv(`/v1/admin/reports/orders.csv?${queryRange(from, to)}`, "orders.csv");
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not export orders."); }
  }

  async function signOut() {
    await logout();
    onSignedOut();
  }

  const maxDaily = Math.max(1, ...daily.map((day) => day.gmvMinor));

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">d</span><div><strong>delivery_app</strong><small>operations</small></div></div>
      <nav>{TABS.map(([key, label]) => <button key={key} className={tab === key ? "active" : ""} onClick={() => { setTab(key); setStatusFilter(""); setError(""); }}>{label}</button>)}</nav>
      <div className="sidebar-foot">
        <span className="avatar">{(session.user.displayName ?? session.user.phoneE164 ?? "OP").slice(0, 2).toUpperCase()}</span>
        <div><strong>{session.user.displayName ?? session.user.phoneE164 ?? "Staff"}</strong><small>{session.user.roles.join(", ")}</small></div>
        <button className="sign-out" onClick={() => void signOut()}>Sign out</button>
      </div>
    </aside>
    <main className="workspace">
      <header className="workspace-head">
        <div><p className="eyebrow">{TABS.find(([key]) => key === tab)?.[1]}</p><h1>{tab === "overview" ? "City pulse" : tab === "config" ? "System controls" : tab === "audit" ? "Audit trail" : TABS.find(([key]) => key === tab)?.[1]}</h1></div>
        <button className="ghost" onClick={() => void load()} disabled={loading}>{loading ? "Loading…" : "Refresh"}</button>
      </header>
      {error && <p className="form-error">{error}</p>}

      {tab === "overview" && <Overview dashboard={dashboard} daily={daily} finance={finance} maxDaily={maxDaily} from={from} to={to} setFrom={setFrom} setTo={setTo} />}

      {tab === "orders" && <section className="stack">
        <div className="panel">
          <div className="panel-head">
            <div><p className="eyebrow">REPORT WINDOW</p><h2>Orders & revenue</h2></div>
            <button className="ghost" onClick={() => void exportOrders()}>Export CSV</button>
          </div>
          <div className="toolbar">
            <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
            <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
            <label>Status<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All statuses</option>{["PENDING_CONFIRMATION", "AWAITING_PAYMENT", "CONFIRMED", "PREPARING", "READY_FOR_PICKUP", "PICKED_UP", "DELIVERED", "CANCELLED"].map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></label>
          </div>
        </div>
        {summary && <div className="metric-grid">
          <Metric label="GMV" value={money(summary.gmvMinor)} note={`${summary.orders} orders`} accent />
          <Metric label="Delivered" value={String(summary.delivered)} note={`${summary.cancelled} cancelled`} />
          <Metric label="Commission" value={money(summary.commissionMinor)} note={`Tips ${money(summary.tipsMinor)}`} />
          <Metric label="Refunded" value={money(summary.refundedMinor)} note={`Avg order ${money(summary.averageOrderMinor)}`} />
        </div>}
        <div className="panel table-wrap">
          <table><thead><tr><th>Order</th><th>Merchant</th><th>Customer</th><th>Courier</th><th>Status</th><th>Total</th><th>Created</th></tr></thead>
            <tbody>{orders.map((order) => <tr key={order.id}>
              <td><strong>{order.orderNumber}</strong></td><td>{order.merchantName}</td>
              <td>{order.customerPhone ?? "—"}</td><td>{order.courierPhone ?? "—"}</td>
              <td><span className={`status-text ${order.status.toLowerCase()}`}>{order.status.replaceAll("_", " ")}</span><small className="block">{order.paymentStatus}</small></td>
              <td>{money(order.totalMinor, order.currency)}</td><td>{shortDate(order.createdAt)}</td>
            </tr>)}</tbody>
          </table>
          {orders.length === 0 && <p className="empty">No orders in this window.</p>}
        </div>
      </section>}

      {tab === "merchants" && <section className="stack">
        <div className="toolbar-inline">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All merchants</option>{["pending", "active", "suspended", "closed"].map((status) => <option key={status} value={status}>{status}</option>)}</select>
        </div>
        <div className="panel table-wrap">
          <table><thead><tr><th>Merchant</th><th>Owner</th><th>Orders</th><th>Rating</th><th>Status</th><th>Joined</th><th /></tr></thead>
            <tbody>{merchants.map((merchant) => <tr key={merchant.id}>
              <td><strong>{merchant.displayName}</strong><small className="block">{merchant.slug}</small></td>
              <td>{merchant.ownerPhone ?? "—"}</td><td>{merchant.orderCount}</td>
              <td>{merchant.rating.toFixed(1)} <small>({merchant.ratingCount})</small></td>
              <td><span className={`status-pill ${merchant.status}`}>{merchant.status}</span></td>
              <td>{shortDate(merchant.createdAt)}</td>
              <td className="actions">
                {merchant.status !== "active" && <button className="ghost" onClick={() => void setMerchantStatus(merchant, "active")}>Activate</button>}
                {merchant.status !== "suspended" && <button className="ghost danger" onClick={() => void setMerchantStatus(merchant, "suspended")}>Suspend</button>}
              </td>
            </tr>)}</tbody>
          </table>
          {merchants.length === 0 && <p className="empty">No merchants match this filter.</p>}
        </div>
      </section>}

      {tab === "couriers" && <section className="stack">
        <div className="toolbar-inline">
          <select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="">All couriers</option>{["pending", "approved", "rejected", "suspended"].map((status) => <option key={status} value={status}>{status}</option>)}</select>
        </div>
        <div className="panel table-wrap">
          <table><thead><tr><th>Courier</th><th>Vehicle</th><th>Rating</th><th>Deliveries</th><th>Docs</th><th>Status</th><th /></tr></thead>
            <tbody>{couriers.map((courier) => <tr key={courier.userId}>
              <td><strong>{courier.fullName ?? "Unnamed courier"}</strong><small className="block">{courier.phoneE164}{courier.isOnline ? " · online" : ""}</small></td>
              <td>{courier.vehicleType ?? "—"}<small className="block">{courier.vehiclePlate ?? ""}</small></td>
              <td>{courier.rating.toFixed(1)}</td><td>{courier.completedDeliveries}</td>
              <td><button className="ghost" onClick={() => void openDocuments(courier)}>{courier.pendingDocuments} pending</button></td>
              <td><span className={`status-pill ${courier.status}`}>{courier.status}</span></td>
              <td className="actions">
                {courier.status !== "approved" && <button className="ghost" onClick={() => void reviewCourier(courier, "approve")}>Approve</button>}
                {courier.status === "pending" && <button className="ghost danger" onClick={() => void reviewCourier(courier, "reject")}>Reject</button>}
                {courier.status === "approved" && <button className="ghost danger" onClick={() => void reviewCourier(courier, "suspend")}>Suspend</button>}
              </td>
            </tr>)}</tbody>
          </table>
          {couriers.length === 0 && <p className="empty">No couriers match this filter.</p>}
        </div>
        {documents && <div className="panel">
          <div className="panel-head">
            <div><p className="eyebrow">DOCUMENT REVIEW</p><h2>{documents.courier.fullName ?? "Courier"}</h2></div>
            <button className="ghost" onClick={() => setDocuments(null)}>Close</button>
          </div>
          {documents.items.length === 0 ? <p className="muted">No documents uploaded.</p> : <div className="stack">
            {documents.items.map((document) => <div className="document-row" key={document.id}>
              <div><strong>{document.document_type.replaceAll("_", " ")}</strong><small className="block">{document.storage_key}</small></div>
              <span className={`status-pill ${document.status}`}>{document.status}</span>
              <div className="actions">
                <button className="ghost" onClick={() => void reviewDocument(document, "approved")}>Approve</button>
                <button className="ghost danger" onClick={() => void reviewDocument(document, "rejected")}>Reject</button>
              </div>
            </div>)}
          </div>}
        </div>}
      </section>}

      {tab === "users" && <section className="stack">
        <form className="toolbar-inline" onSubmit={(event) => { event.preventDefault(); void load(); }}>
          <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search phone, email or name" />
          <button>Search</button>
        </form>
        {editingUser && <div className="panel">
          <div className="panel-head"><div><p className="eyebrow">ROLE ASSIGNMENT</p><h2>{editingUser.displayName ?? editingUser.phoneE164}</h2></div><button className="ghost" onClick={() => setEditingUser(null)}>Cancel</button></div>
          <div className="role-grid">{ROLES.map((role) => <label className="check" key={role}><input type="checkbox" checked={draftRoles.includes(role)} onChange={(event) => setDraftRoles((current) => event.target.checked ? [...current, role] : current.filter((item) => item !== role))} /> {role.replaceAll("_", " ")}</label>)}</div>
          <button onClick={() => void saveRoles()}>Save roles</button>
        </div>}
        <div className="panel table-wrap">
          <table><thead><tr><th>User</th><th>Contact</th><th>Roles</th><th>Status</th><th>Joined</th><th /></tr></thead>
            <tbody>{users.map((user) => <tr key={user.id}>
              <td><strong>{user.displayName ?? "Unnamed"}</strong></td><td>{user.phoneE164 ?? "—"}<small className="block">{user.email ?? ""}</small></td>
              <td>{user.roles.join(", ") || "—"}</td>
              <td><select value={user.accountStatus} onChange={(event) => void setUserStatus(user, event.target.value)}>{USER_STATUSES.map((status) => <option key={status} value={status}>{status.replaceAll("_", " ")}</option>)}</select></td>
              <td>{shortDate(user.createdAt)}</td>
              <td><button className="ghost" onClick={() => { setEditingUser(user); setDraftRoles(user.roles); }}>Edit roles</button></td>
            </tr>)}</tbody>
          </table>
          {users.length === 0 && <p className="empty">No users found.</p>}
        </div>
      </section>}

      {tab === "config" && <section className="stack">
        <div className="two-column">
          <div className="panel">
            <p className="eyebrow">FEATURE FLAGS</p><h2>Release controls</h2>
            <div className="stack">{flags.map((flag) => <div className="flag-row" key={flag.key}>
              <div><strong>{flag.key}</strong><p>{flag.description}</p></div>
              <button className={flag.enabled ? "toggle on" : "toggle"} onClick={() => void toggleFlag(flag)}>{flag.enabled ? "Enabled" : "Disabled"}</button>
            </div>)}</div>
            {flags.length === 0 && <p className="muted">No flags configured.</p>}
          </div>
          <form className="panel stack" onSubmit={(event) => void savePricing(event)}>
            <div><p className="eyebrow">PRICING</p><h2>Publish a pricing rule</h2><p className="muted">Publishing deactivates the current default rule for your launch city.</p></div>
            <div className="form-grid">
              <label>Base fee (minor)<input type="number" min={0} value={pricing.baseDeliveryFeeMinor} onChange={(event) => setPricing({ ...pricing, baseDeliveryFeeMinor: Number(event.target.value) })} /></label>
              <label>Per km (minor)<input type="number" min={0} value={pricing.perKmFeeMinor} onChange={(event) => setPricing({ ...pricing, perKmFeeMinor: Number(event.target.value) })} /></label>
              <label>Minimum fee (minor)<input type="number" min={0} value={pricing.minimumDeliveryFeeMinor} onChange={(event) => setPricing({ ...pricing, minimumDeliveryFeeMinor: Number(event.target.value) })} /></label>
              <label>Maximum fee (minor)<input type="number" min={0} value={pricing.maximumDeliveryFeeMinor} onChange={(event) => setPricing({ ...pricing, maximumDeliveryFeeMinor: Number(event.target.value) })} /></label>
              <label>Service fee (minor)<input type="number" min={0} value={pricing.serviceFeeMinor} onChange={(event) => setPricing({ ...pricing, serviceFeeMinor: Number(event.target.value) })} /></label>
              <label>Night surcharge (minor)<input type="number" min={0} value={pricing.nightSurchargeMinor} onChange={(event) => setPricing({ ...pricing, nightSurchargeMinor: Number(event.target.value) })} /></label>
              <label>Commission (bps)<input type="number" min={0} max={10000} value={pricing.commissionBps} onChange={(event) => setPricing({ ...pricing, commissionBps: Number(event.target.value) })} /></label>
              <label>Currency<input value={pricing.currency} maxLength={3} onChange={(event) => setPricing({ ...pricing, currency: event.target.value.toUpperCase() })} /></label>
            </div>
            <button>Publish pricing rule</button>
          </form>
        </div>
        <div className="panel">
          <div className="panel-head"><div><p className="eyebrow">SERVICE ZONES</p><h2>Delivery boundaries</h2></div></div>
          <div className="stack">{zones.map((zone) => <div className="flag-row" key={zone.id}>
            <div><strong>{zone.displayName}</strong><p>{zone.cityName} · {zone.slug}</p></div>
            <button className={zone.isActive ? "toggle on" : "toggle"} onClick={() => void toggleZone(zone)}>{zone.isActive ? "Active" : "Paused"}</button>
          </div>)}</div>
          {zones.length === 0 && <p className="muted">No service zones configured.</p>}
        </div>
      </section>}

      {tab === "audit" && <div className="panel table-wrap">
        <table><thead><tr><th>When</th><th>Actor</th><th>Action</th><th>Entity</th><th>Request</th></tr></thead>
          <tbody>{audit.map((entry) => <tr key={entry.id}>
            <td>{shortDate(entry.createdAt)}</td><td>{entry.actorUserId ?? "system"}</td>
            <td><strong>{entry.action}</strong></td><td>{entry.entityType}{entry.entityId ? <small className="block">{entry.entityId}</small> : null}</td>
            <td>{entry.requestId ?? "—"}</td>
          </tr>)}</tbody>
        </table>
        {audit.length === 0 && <p className="empty">No audit entries yet.</p>}
      </div>}
    </main>
    {toast && <div className="toast">{toast}</div>}
  </div>;
}

function Overview({ dashboard, daily, finance, maxDaily, from, to, setFrom, setTo }: {
  dashboard: Dashboard | null; daily: DailyRow[]; finance: Finance | null; maxDaily: number;
  from: string; to: string; setFrom: (value: string) => void; setTo: (value: string) => void;
}) {
  return <section className="stack">
    <div className="toolbar-inline">
      <label>From<input type="date" value={from} onChange={(event) => setFrom(event.target.value)} /></label>
      <label>To<input type="date" value={to} onChange={(event) => setTo(event.target.value)} /></label>
    </div>
    <div className="metric-grid">
      <Metric label="Orders today" value={String(dashboard?.ordersToday ?? 0)} note={`${dashboard?.deliveriesToday ?? 0} delivered`} accent />
      <Metric label="GMV today" value={money(dashboard?.gmvTodayMinor ?? 0)} note={`${dashboard?.activeOrders ?? 0} active orders`} />
      <Metric label="Couriers online" value={String(dashboard?.onlineCouriers ?? 0)} note={`${dashboard?.pendingCouriers ?? 0} awaiting review`} />
      <Metric label="Needs attention" value={String((dashboard?.pendingRefunds ?? 0) + (dashboard?.openTickets ?? 0))} note={`${dashboard?.pendingRefunds ?? 0} refunds · ${dashboard?.openTickets ?? 0} tickets`} />
    </div>
    <div className="two-column">
      <div className="panel">
        <div className="panel-head"><div><p className="eyebrow">REVENUE TREND</p><h2>Daily GMV</h2></div></div>
        {daily.length === 0 ? <p className="muted">No activity in this window.</p> : <div className="bars">
          {daily.map((day) => <div className="bar-row" key={day.day}>
            <span>{new Date(day.day).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>
            <div className="bar-track"><div className="bar-fill" style={{ width: `${Math.max(2, day.gmvMinor / maxDaily * 100)}%` }} /></div>
            <strong>{money(day.gmvMinor)}</strong><small>{day.orders} orders</small>
          </div>)}
        </div>}
      </div>
      <div className="panel">
        <div className="panel-head"><div><p className="eyebrow">MONEY MOVEMENT</p><h2>Payments</h2></div></div>
        {finance?.payments.length ? <table><thead><tr><th>Provider</th><th>Status</th><th>Count</th><th>Total</th></tr></thead>
          <tbody>{finance.payments.map((payment) => <tr key={`${payment.provider}-${payment.status}`}><td>{payment.provider}</td><td>{payment.status}</td><td>{payment.count}</td><td>{money(payment.totalMinor)}</td></tr>)}</tbody>
        </table> : <p className="muted">No payments in this window.</p>}
        {finance?.refunds.length ? <div className="sub-panel">
          <p className="eyebrow">REFUNDS</p>
          {finance.refunds.map((refund) => <div className="detail-line" key={refund.status}><span>{refund.status}</span><strong>{money(refund.totalMinor)} <small>({refund.count})</small></strong></div>)}
        </div> : null}
      </div>
    </div>
  </section>;
}

function Metric({ label, value, note, accent = false }: { label: string; value: string; note: string; accent?: boolean }) {
  return <article className={accent ? "metric accent" : "metric"}><span>{label}</span><strong>{value}</strong><p>{note}</p></article>;
}
