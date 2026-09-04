// ============================================================================
// Contact extraction from the free-form company profile fields.
//
// Users fill contacts in different places: dedicated columns, the commercial
// profile JSON, or the free text "site_contacts" block written by the site
// generator. Launch readiness used to read only the first two, so a project
// with a perfectly filled contacts block still reported "phone is missing".
//
// Pure + deterministic: no invention, only what the text already contains.
// ============================================================================

const t = (v: unknown) => String(v ?? "").trim();

/** Strips HTML tags and entities, keeps text separated by spaces. */
export function plainText(v: unknown): string {
  return t(v)
    .replace(/<br\s*\/?>/gi, " ")
    .replace(/<\/(p|div|li|h[1-6])>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/\s+/g, " ")
    .trim();
}

export function extractEmail(...sources: unknown[]): string {
  for (const s of sources) {
    const m = plainText(s).match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/);
    if (m) return m[0];
  }
  return "";
}

export function extractPhone(...sources: unknown[]): string {
  for (const s of sources) {
    const text = plainText(s);
    const m = text.match(/(?:\+?\d[\d\s().-]{8,}\d)/);
    if (!m) continue;
    const raw = m[0].trim();
    const digits = raw.replace(/\D/g, "");
    if (digits.length >= 10 && digits.length <= 15) return raw;
  }
  return "";
}

/** A fragment that looks like a postal address (city / street / index markers). */
export function extractAddress(...sources: unknown[]): string {
  const patterns = [
    /(?:\b\d{5,6},?\s)?(?:г\.|город\s|гор\.)\s?[^;|<>]{5,140}/i,
    /(?:ул\.|улица|просп\.|проспект|пр-т|пер\.|шоссе|наб\.)\s?[^;|<>]{4,140}/i,
    /\d+\s+[A-Za-z][A-Za-z\s]{2,60}(?:street|st\.|avenue|ave\.|road|rd\.|drive|dr\.)[^;|<>]{0,60}/i,
  ];
  for (const s of sources) {
    const text = plainText(s);
    if (!text) continue;
    for (const re of patterns) {
      const m = text.match(re);
      if (!m) continue;
      const val = m[0].replace(/\s+/g, " ").replace(/[,\s]+$/, "").trim();
      if (val.length >= 8 && !/@/.test(val)) return val;
    }
  }
  return "";
}

export interface ResolvedContacts { phone: string; email: string; address: string }

/**
 * Best-effort contacts for a project row: explicit fields win, the free-form
 * contacts block is parsed only when a field is empty.
 */
export function resolveProjectContacts(project: Record<string, unknown>): ResolvedContacts {
  const cp = (project.commercial_profile || {}) as Record<string, unknown>;
  const free = [project.site_contacts, project.site_about];
  return {
    phone: t(cp.phone) || t(project.company_phone) || extractPhone(...free),
    email: t(cp.email) || t(project.company_email) || extractEmail(...free),
    address:
      t(cp.address) || t(project.company_address) || t(project.legal_address) ||
      extractAddress(...free),
  };
}
