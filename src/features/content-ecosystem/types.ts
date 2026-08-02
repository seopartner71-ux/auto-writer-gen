export interface Client {
  id: string;
  user_id: string;
  name: string;
  domain: string | null;
  description: string | null;
  logo_url: string | null;
  brand_color: string;
  expert_name: string | null;
  expert_bio: string | null;
  expert_photo_url: string | null;
  contact_email: string | null;
  contact_phone: string | null;
  brand_voice: string | null;
  default_utm_source: string | null;
  anchors: unknown; // JSONB - use `getClientAnchors(client)` to read as ClientAnchor[]
  archived: boolean;
  created_at: string;
  updated_at: string;
  github_username?: string | null;
  github_repo?: string | null;
  github_token_encrypted?: string | null;
  github_pages_url?: string | null;
  client_pages?: unknown; // JSONB — read via getClientPages(client)
}

export type DeploymentStatus = "pending" | "deploying" | "deployed" | "failed";

export interface FormatDeployment {
  id: string;
  ecosystem_format_id: string;
  platform: "github_pages";
  status: DeploymentStatus;
  published_url: string | null;
  error_reason: string | null;
  deployed_at: string | null;
  created_at: string;
  updated_at: string;
  pdf_url?: string | null;
  archive_org_status?: string | null;
  archive_org_url?: string | null;
  archive_org_pdf_url?: string | null;
  archive_org_uploaded_at?: string | null;
  archive_org_error?: string | null;
}

export type AnchorPriority = "high" | "medium" | "low";

export interface ClientAnchor {
  id: string;
  text: string;
  text_variants?: string[];
  target_url: string;
  priority: AnchorPriority;
  archived: boolean;
}

export function getClientAnchors(client: Pick<Client, "anchors"> | null | undefined): ClientAnchor[] {
  const raw = client?.anchors;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object")
    .map((a) => ({
      id: String(a.id || crypto.randomUUID()),
      text: String(a.text || "").trim(),
      text_variants: Array.isArray((a as any).text_variants)
        ? ((a as any).text_variants as unknown[])
            .map((v) => String(v || "").trim())
            .filter((v) => v.length > 0)
            .slice(0, 8)
        : [],
      target_url: String(a.target_url || "").trim(),
      priority: (a.priority === "high" || a.priority === "low" ? a.priority : "medium") as AnchorPriority,
      archived: Boolean(a.archived),
    }))
    .filter((a) => a.text && a.target_url);
}

export interface ClientPage {
  id: string;
  url: string;
  title: string;
  description: string;
  h1: string;
  priority: "high" | "medium" | "low";
  category: string;
  added_at: string;
  source: "sitemap" | "manual";
}

export function getClientPages(client: Pick<Client, "client_pages"> | null | undefined): ClientPage[] {
  const raw = (client as any)?.client_pages;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
    .map((p) => ({
      id: String(p.id || crypto.randomUUID()),
      url: String(p.url || "").trim(),
      title: String(p.title || "").trim(),
      description: String(p.description || "").trim(),
      h1: String(p.h1 || "").trim(),
      priority: (p.priority === "high" || p.priority === "low" ? p.priority : "medium") as "high" | "medium" | "low",
      category: String(p.category || "").trim(),
      added_at: String(p.added_at || new Date().toISOString()),
      source: (p.source === "manual" ? "manual" : "sitemap") as "sitemap" | "manual",
    }))
    .filter((p) => /^https?:\/\//i.test(p.url));
}

export const CLIENT_PAGES_PLAN_LIMITS: Record<string, number> = {
  nano: 0,
  basic: 100,
  pro: 1000,
};

export function clientPagesLimit(plan: string | null | undefined): number {
  return CLIENT_PAGES_PLAN_LIMITS[plan || "nano"] ?? 0;
}

export function isValidPageUrlForDomain(url: string, domain: string | null | undefined): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  let u: URL;
  try { u = new URL(url); } catch { return false; }
  const cd = (domain || "").trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!cd) return true;
  const host = u.hostname.toLowerCase();
  return host === cd || host.endsWith(`.${cd}`);
}

export type EcosystemStatus = "draft" | "generating" | "completed" | "failed";

export interface ContentEcosystem {
  id: string;
  user_id: string;
  client_id: string;
  source_article_id: string | null;
  status: EcosystemStatus;
  formats_requested: string[];
  formats_completed: string[];
  created_at: string;
  updated_at: string;
}

export type FormatType =
  | "vc_ru"
  | "dzen"
  | "scribd_pdf"
  | "google_docs"
  | "presentation"
  | "checklist"
  | "issuu"
  | "google_sites"
  | "branded_pdf";

export interface EcosystemFormat {
  id: string;
  ecosystem_id: string;
  format_type: FormatType;
  status: string;
  content: string | null;
  model_used: string | null;
  generated_at: string | null;
  progress?: number;
  pdf_url?: string | null;
  pdf_path?: string | null;
  error_reason?: string | null;
  retry_count?: number;
  started_at?: string | null;
  duration_ms?: number | null;
  image_urls?: string[] | null;
  content_html?: string | null;
}

export const FORMAT_LABELS: Record<FormatType, { ru: string; en: string }> = {
  vc_ru: { ru: "VC.ru", en: "VC.ru" },
  dzen: { ru: "Дзен", en: "Dzen" },
  scribd_pdf: { ru: "Scribd PDF", en: "Scribd PDF" },
  google_docs: { ru: "Google Docs", en: "Google Docs" },
  presentation: { ru: "Презентация", en: "Presentation" },
  checklist: { ru: "Чек-лист", en: "Checklist" },
  issuu: { ru: "Issuu (инструкция)", en: "Issuu (guide)" },
  google_sites: { ru: "Google Sites (инструкция)", en: "Google Sites (guide)" },
  branded_pdf: { ru: "Брендированный PDF", en: "Branded PDF" },
};

export const MVP_FORMATS: FormatType[] = [
  "vc_ru",
  "dzen",
  "scribd_pdf",
  "google_docs",
  "presentation",
  "checklist",
];

export const GUIDE_FORMATS: FormatType[] = ["issuu", "google_sites"];

export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9а-я]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
}

export interface PlanEcosystemLimits {
  clientLimit: number; // -1 unlimited, 0 locked
  ecosystemsEnabled: boolean;
  requiredPlanForEcosystems: string;
}

// Map internal plans (nano/basic/pro) to feature limits per spec.
// nano=NANO (0 clients), basic=PRO (3 clients, no ecosystems),
// pro=FACTORY (unlimited clients + ecosystems).
export function limitsForPlan(plan: string | null | undefined): PlanEcosystemLimits {
  switch (plan) {
    case "pro":
      return { clientLimit: -1, ecosystemsEnabled: true, requiredPlanForEcosystems: "FACTORY" };
    case "basic":
      return { clientLimit: 3, ecosystemsEnabled: false, requiredPlanForEcosystems: "FACTORY" };
    default:
      return { clientLimit: 0, ecosystemsEnabled: false, requiredPlanForEcosystems: "FACTORY" };
  }
}