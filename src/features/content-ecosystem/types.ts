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
  archived: boolean;
  created_at: string;
  updated_at: string;
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