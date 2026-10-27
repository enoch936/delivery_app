export type SessionUser = {
  id: string;
  phoneE164: string | null;
  displayName: string | null;
  roles: string[];
};

export type Session = {
  accessToken: string;
  refreshToken: string;
  expiresAt: string;
  refreshExpiresAt: string;
  user: SessionUser;
};

const API_BASE = (process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://localhost:3000/api").replace(/\/$/, "");
const STORAGE_KEY = "delivery.admin.session";

export function loadSession(): Session | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const session = JSON.parse(raw) as Session;
    return session.accessToken ? session : null;
  } catch {
    return null;
  }
}

export function saveSession(session: Session | null): void {
  if (typeof window === "undefined") return;
  if (session) window.localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
  else window.localStorage.removeItem(STORAGE_KEY);
}

async function parse<T>(response: Response): Promise<T> {
  const text = await response.text();
  const body = text ? JSON.parse(text) : null;
  if (!response.ok) {
    const message = body && typeof body === "object" && "message" in body
      ? Array.isArray(body.message) ? body.message.join(", ") : String(body.message)
      : `Request failed (${response.status})`;
    throw new Error(message);
  }
  return body as T;
}

async function refresh(session: Session): Promise<Session | null> {
  try {
    const response = await fetch(`${API_BASE}/v1/auth/refresh`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ refreshToken: session.refreshToken })
    });
    if (!response.ok) return null;
    const next = await parse<Session>(response);
    saveSession(next);
    return next;
  } catch {
    return null;
  }
}

export async function api<T>(path: string, init: RequestInit = {}, retry = true): Promise<T> {
  const session = loadSession();
  if (!session) throw new Error("Please sign in again.");
  const headers = new Headers(init.headers);
  headers.set("authorization", `Bearer ${session.accessToken}`);
  if (init.body && !headers.has("content-type")) headers.set("content-type", "application/json");
  const response = await fetch(`${API_BASE}${path}`, { ...init, headers });
  if (response.status === 401 && retry) {
    const next = await refresh(session);
    if (next) return api<T>(path, init, false);
    saveSession(null);
  }
  return parse<T>(response);
}

export async function requestOtp(phoneE164: string): Promise<{ challengeId: string; expiresAt: string }> {
  const response = await fetch(`${API_BASE}/v1/auth/otp/request`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneE164 })
  });
  return parse(response);
}

export async function verifyOtp(phoneE164: string, code: string, challengeId: string): Promise<Session> {
  const response = await fetch(`${API_BASE}/v1/auth/otp/verify`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ phoneE164, code, challengeId })
  });
  const session = await parse<Session>(response);
  saveSession(session);
  return session;
}

export async function logout(): Promise<void> {
  const session = loadSession();
  if (!session) return;
  try {
    await api("/v1/auth/logout", { method: "POST", body: JSON.stringify({ refreshToken: session.refreshToken }) }, false);
  } catch {
    // Local session is cleared even when the server session already expired.
  } finally {
    saveSession(null);
  }
}

export async function downloadCsv(path: string, filename: string): Promise<void> {
  const session = loadSession();
  if (!session) throw new Error("Please sign in again.");
  const response = await fetch(`${API_BASE}${path}`, {
    headers: { authorization: `Bearer ${session.accessToken}` }
  });
  if (!response.ok) throw new Error(`Export failed (${response.status})`);
  const url = URL.createObjectURL(await response.blob());
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

export function money(minor: number, currency = "ETB"): string {
  return new Intl.NumberFormat("en-ET", { style: "currency", currency, maximumFractionDigits: 2 }).format(minor / 100);
}

export function shortDate(value: string | null | undefined): string {
  return value ? new Date(value).toLocaleString() : "—";
}
