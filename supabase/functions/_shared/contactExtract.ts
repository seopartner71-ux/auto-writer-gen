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

/** A line that looks like a postal address (city / street markers or index). */
export function extractAddress(...sources: unknown[]): string {
  const markers = /(ул\.|улица|просп|пр-т|пер\.|шоссе|д\.\s?\d|дом\s\d|обл\.|г\.\s?[А-ЯЁA-Z]|street|st\.|avenue|ave\.|road|rd\.|suite|floor|\b\d{5,6}\b)/i;
  for (const s of sources) {
    const text = plainText(s);
    if (!text) continue;
    const chunks = text.split(/(?:[.;]|\s{2,})/).map((c) => c.trim()).filter(Boolean);
    for (const c of chunks) {
      if (c.length >= 8 && c.length <= 200 && markers.test(c) && !/@/.test(c)) return c;
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
