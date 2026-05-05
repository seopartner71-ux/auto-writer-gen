// Centralized plan-based limits. DB stores: free (NANO) | basic (PRO) | pro (FACTORY).
// We also accept marketing aliases (nano/pro/factory) for forward-compat.

export const IMPROVE_LIMITS: Record<string, number> = {
  // DB ids
  free: 3,
  basic: 999,
  pro: 999,
  // Marketing aliases
  nano: 3,
  factory: 999,
  // Other tiers
  starter: 3,
  business: 999,
  enterprise: 999,
  admin: 999,
  default: 3,
};

export const BULK_LIMITS: Record<string, number> = {
  free: 0,
  nano: 0,
  basic: 10,
  pro: 999,
  factory: 999,
  business: 30,
  enterprise: 999,
  admin: 999,
  default: 0,
};

export function normalizePlanKey(plan: string | null | undefined): string {
  return (plan || "").toLowerCase().trim().replace(/[^a-z]/g, "");
}

export function getPlanLimit(
  plan: string | null | undefined,
  limits: Record<string, number> = IMPROVE_LIMITS,
): number {
  const key = normalizePlanKey(plan);
  const v = limits[key];
  return typeof v === "number" ? v : (limits.default ?? 3);
}