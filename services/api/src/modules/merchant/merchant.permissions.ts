export const MERCHANT_PERMISSIONS = [
  "orders:manage",
  "catalog:manage",
  "settings:manage",
  "staff:manage",
  "finance:view",
  "communication:manage",
  "support:manage",
  "audit:view"
] as const;

export type MerchantPermission = (typeof MERCHANT_PERMISSIONS)[number];

const MANAGER_PERMISSIONS: readonly MerchantPermission[] = [
  "orders:manage",
  "catalog:manage",
  "settings:manage",
  "finance:view",
  "communication:manage",
  "support:manage",
  "audit:view"
];

const STAFF_PERMISSIONS: readonly MerchantPermission[] = [
  "orders:manage",
  "communication:manage"
];

export function permissionsForRole(role: string, explicit: readonly string[] | null | undefined): MerchantPermission[] {
  if (role === "owner") return [...MERCHANT_PERMISSIONS];
  const allowed = new Set<MerchantPermission>(role === "manager" ? MANAGER_PERMISSIONS : STAFF_PERMISSIONS);
  const selected: MerchantPermission[] = explicit && explicit.length > 0
    ? explicit.filter((permission): permission is MerchantPermission => allowed.has(permission as MerchantPermission))
    : [...allowed];
  return [...new Set(selected)];
}

export function normalizeInvitationPermissions(role: string, permissions: readonly string[] | undefined): MerchantPermission[] {
  if (role === "owner") return [...MERCHANT_PERMISSIONS];
  const allowed = new Set<string>(role === "manager" ? MANAGER_PERMISSIONS : STAFF_PERMISSIONS);
  return [...new Set((permissions ?? []).filter((permission): permission is MerchantPermission => allowed.has(permission)))];
}

export function hasMerchantPermission(role: string, permissions: readonly string[], permission: MerchantPermission): boolean {
  if (role === "owner") return true;
  return permissionsForRole(role, permissions).includes(permission);
}
