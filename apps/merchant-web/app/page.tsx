"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  api,
  loadSession,
  logout,
  money,
  requestOtp,
  saveSession,
  verifyOtp,
  type Session
} from "../lib/api";

type Tab = "overview" | "orders" | "menu" | "settlements";

type MerchantLocation = {
  id: string; name: string; addressLine: string; latitude: number | null; longitude: number | null;
  openingHours: Record<string, unknown>; isActive: boolean;
};

type MerchantMe = {
  merchant: { id: string; slug: string; displayName: string; description: string | null; logoUrl: string | null; status: string; commissionBps: number };
  membership: { role: string };
  locations: MerchantLocation[];
  categories: Array<{ id: string; slug: string; display_name: string; sort_order: number }>;
  stats: { todayOrders: number; pendingOrders: number; revenueTodayMinor: number };
};

type MerchantOrder = {
  id: string; orderNumber: string; status: string; paymentStatus: string; totalMinor: number; currency: string;
  deliveryAddress: string | null; itemCount: number; deliveryEstimateMinutes: number | null; createdAt: string;
};

type MenuProduct = {
  id: string; categoryId: string | null; sku: string | null; displayName: string; description: string | null;
  imageUrl: string | null; basePriceMinor: number; currency: string; isAvailable: boolean; quantityAvailable: number;
};

type MenuResponse = {
  categories: Array<{ id: string; slug: string; displayName: string; sortOrder: number }>;
  products: MenuProduct[];
};

type Settlement = {
  id: string; periodStart: string; periodEnd: string; grossMinor: number; commissionMinor: number;
  netPayableMinor: number; currency: string; status: string; paidAt: string | null;
};

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

  return <div className="app-shell">
    <aside className="sidebar">
      <div className="brand"><span className="brand-mark">d</span><div><strong>delivery_app</strong><small>merchant</small></div></div>
      <nav>
        {([
          ["overview", "Overview"],
          ["orders", "Orders"],
          ["menu", "Menu & stock"],
          ["settlements", "Settlements"]
        ] as const).map(([value, label]) => <button key={value} className={tab === value ? "active" : ""} onClick={() => setTab(value)}>{label}</button>)}
      </nav>
      <div className="sidebar-foot">
        <div className="avatar">{initials}</div>
        <div><strong>{session.user.displayName ?? session.user.phoneE164}</strong><small>{me?.membership.role ?? "staff"}</small></div>
        <button className="sign-out" onClick={onSignOut}>Sign out</button>
      </div>
    </aside>
    <main className="workspace">
      <header className="workspace-head">
        <div>
          <p className="eyebrow">{tab.toUpperCase()}</p>
          <h1>{tab === "overview" ? name : tab === "orders" ? "Order queue" : tab === "menu" ? "Menu & stock" : "Settlement history"}</h1>
        </div>
        {me ? <div className={`status-pill ${me.merchant.status}`}>{me.merchant.status}</div> : null}
      </header>

      {loading && !me ? <div className="panel empty">Loading merchant…</div> : null}
      {error && !me ? <div className="panel empty">
        <h2>Workspace unavailable</h2>
        <p>{error}</p>
        <p className="muted">This phone must be linked to a merchant by an operator before staff can sign in.</p>
        <button onClick={() => void refresh()}>Try again</button>
      </div> : null}

      {me && tab === "overview" ? <Overview me={me} reload={refresh} notify={setToast} /> : null}
      {me && tab === "orders" ? <Orders notify={setToast} /> : null}
      {me && tab === "menu" ? <Menu me={me} reload={refresh} notify={setToast} /> : null}
      {me && tab === "settlements" ? <Settlements /> : null}
    </main>
    {toast ? <div className="toast">{toast}</div> : null}
  </div>;
}

function Overview({ me, reload, notify }: { me: MerchantMe; reload: () => Promise<void>; notify: (message: string) => void }) {
  const [savingLocation, setSavingLocation] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [displayName, setDisplayName] = useState(me.merchant.displayName);
  const [description, setDescription] = useState(me.merchant.description ?? "");

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    try {
      await api("/v1/merchant/me", { method: "PATCH", body: JSON.stringify({ displayName, description }) });
      notify("Merchant profile updated.");
      setEditing(false);
      await reload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the profile.");
    }
  }

  async function toggleLocation(location: MerchantLocation) {
    setSavingLocation(location.id);
    try {
      await api(`/v1/merchant/locations/${location.id}`, { method: "PATCH", body: JSON.stringify({ active: !location.isActive }) });
      notify(`${location.name} is now ${location.isActive ? "closed" : "open"}.`);
      await reload();
    } catch (cause) {
      notify(cause instanceof Error ? cause.message : "Could not update the location.");
    } finally {
      setSavingLocation(null);
    }
  }

  return <>
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
          <button className="ghost" onClick={() => setEditing((value) => !value)}>{editing ? "Cancel" : "Edit"}</button>
        </div>
        {editing ? <form className="stack" onSubmit={saveProfile}>
          <label>Display name<input value={displayName} onChange={(event) => setDisplayName(event.target.value)} minLength={2} maxLength={120} required /></label>
          <label>Description<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} maxLength={2000} /></label>
          <button>Save profile</button>
        </form> : <>
          <p className="muted">{me.merchant.description ?? "No public description yet."}</p>
          <dl className="detail-list">
            <div><dt>Slug</dt><dd>/{me.merchant.slug}</dd></div>
            <div><dt>Your role</dt><dd>{me.membership.role}</dd></div>
            <div><dt>Locations</dt><dd>{me.locations.length}</dd></div>
            <div><dt>Menu categories</dt><dd>{me.categories.length}</dd></div>
          </dl>
        </>}
      </section>

      <section className="panel">
        <div className="panel-head"><div><p className="eyebrow">LOCATIONS</p><h2>Availability</h2></div></div>
        {me.locations.length === 0 ? <p className="muted">No locations have been configured.</p> : <div className="location-list">
          {me.locations.map((location) => <article key={location.id} className="location-row">
            <div><strong>{location.name}</strong><p>{location.addressLine}</p></div>
            <button className={location.isActive ? "toggle on" : "toggle"} disabled={savingLocation === location.id} onClick={() => void toggleLocation(location)}>
              {savingLocation === location.id ? "Saving…" : location.isActive ? "Open" : "Closed"}
            </button>
          </article>)}
        </div>}
      </section>
    </div>
  </>;
}

function Orders({ notify }: { notify: (message: string) => void }) {
  const [orders, setOrders] = useState<MerchantOrder[]>([]);
  const [total, setTotal] = useState(0);
  const [status, setStatus] = useState("");
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const query = status ? `?status=${encodeURIComponent(status)}` : "";
      const result = await api<{ items: MerchantOrder[]; total: number }>(`/v1/merchant/orders${query}`);
      setOrders(result.items); setTotal(result.total);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load orders.");
    } finally {
      setLoading(false);
    }
  }, [status]);

  useEffect(() => { void load(); }, [load]);

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

  const filters: Array<[string, string]> = [
    ["", "All"], ["PENDING_CONFIRMATION", "New"], ["ACCEPTED_BY_MERCHANT", "Accepted"],
    ["PREPARING", "Preparing"], ["READY_FOR_PICKUP", "Ready"], ["DELIVERED", "Delivered"]
  ];

  return <section className="panel">
    <div className="panel-head">
      <div><p className="eyebrow">FULFILMENT</p><h2>{total} orders</h2></div>
      <button className="ghost" onClick={() => void load()}>Refresh</button>
    </div>
    <div className="filter-row">{filters.map(([value, label]) => <button key={label} className={status === value ? "chip active" : "chip"} onClick={() => setStatus(value)}>{label}</button>)}</div>
    {loading ? <p className="muted">Loading orders…</p> : error ? <p className="form-error">{error}</p> : orders.length === 0 ? <div className="empty"><h3>No orders here</h3><p>The queue is clear for this filter.</p></div> : <div className="order-list">
      {orders.map((order) => <article key={order.id} className="order-card">
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
  </section>;
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

  const categoriesById = useMemo(() => new Map((menu?.categories ?? []).map((category) => [category.id, category.displayName])), [menu]);

  return <div className="menu-layout">
    <section className="panel">
      <div className="panel-head"><div><p className="eyebrow">CATALOGUE</p><h2>{menu?.products.length ?? 0} products</h2></div><button className="ghost" onClick={() => void load()}>Refresh</button></div>
      {loading ? <p className="muted">Loading menu…</p> : error ? <p className="form-error">{error}</p> : menu && menu.products.length > 0 ? <div className="product-list">
        {menu.products.map((product) => <article key={product.id} className="product-row">
          <div className="product-main">
            <strong>{product.displayName}</strong>
            <p>{categoriesById.get(product.categoryId ?? "") ?? "Uncategorised"} · {money(product.basePriceMinor, product.currency)}</p>
          </div>
          <div className="stock-control">
            <label>Stock<input type="number" min={0} defaultValue={product.quantityAvailable} onBlur={(event) => { const value = Number(event.target.value); if (Number.isInteger(value) && value >= 0 && value !== product.quantityAvailable) void setInventory(product, value); }} /></label>
            <button className={product.isAvailable ? "toggle on" : "toggle"} onClick={() => void toggleProduct(product)}>{product.isAvailable ? "Available" : "Hidden"}</button>
          </div>
        </article>)}
      </div> : <div className="empty"><h3>No products yet</h3><p>Add the first item using the form.</p></div>}
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
        <p className="fine-print">{me.categories.length} categories currently on the menu.</p>
      </section>
    </aside>
  </div>;
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

