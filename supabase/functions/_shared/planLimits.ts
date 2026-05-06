// Centralized plan-based limits.
// REAL DB plan ids: basic = NANO, pro = PRO, factory = FACTORY.
// We also accept marketing aliases (nano/free/business/...) for forward-compat.

// Articles per month (used by generate-article)
export const PLAN_LIMITS: Record<string, number> = {
  basic: 5,      // NANO
  pro: 15,       // PRO
  factory: 999,  // FACTORY
  // aliases / fallbacks
  nano: 5,
  starter: 5,
  free: 5,
  business: 30,
  enterprise: 999,
  admin: 999,
  default: 5,
};

// SEO improve / article improve limits
export const IMPROVE_LIMITS: Record<string, number> = {
  basic: 5,      // NANO
  pro: 999,      // PRO unlimited
  factory: 999,  // FACTORY unlimited
  // aliases
  nano: 5,
  free: 5,
  starter: 5,
  business: 999,
  enterprise: 999,
  admin: 999,
  default: 5,
};

// Backward-compat alias (some callers may import SEO_IMPROVE_LIMITS)
export const SEO_IMPROVE_LIMITS = IMPROVE_LIMITS;

// Bulk generation per-job limits
export const BULK_LIMITS: Record<string, number> = {
  basic: 1,      // NANO (effectively disabled)
  pro: 10,       // PRO
  factory: 999,  // FACTORY
  // aliases
  nano: 1,
  free: 0,
  business: 20,
  enterprise: 999,
  admin: 999,
  default: 1,
};

export function normalizePlanKey(plan: string | null | undefined): string {
  return (plan || "").toLowerCase().trim().replace(/[^a-z]/g, "");
}

export function getPlanLimit(
  plan: string | null | undefined,
  limits: Record<string, number> = PLAN_LIMITS,
): number {
  const key = normalizePlanKey(plan);
  const v = limits[key];
  return typeof v === "number" ? v : (limits.default ?? 5);
}
