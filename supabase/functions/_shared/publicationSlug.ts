// Deterministic per-format publication slug for the Content Ecosystem.
// Same shape used by generate-doc-universal, generate-checklist and
// deploy-to-github-pages so PDF storage paths, HTML landing paths and
// sitemap URLs all agree.
//
// Shape: `${typeSlug}/${keySlug}-${hash8}` where hash8 = first 8 hex
// chars of the ecosystem_formats.id UUID. That gives a stable, unique
// path per format row — two documents of the same type on the same
// keyword for the same client no longer collide.

const RU_MAP: Record<string, string> = {
  а: "a", б: "b", в: "v", г: "g", д: "d", е: "e", ё: "e", ж: "zh",
  з: "z", и: "i", й: "j", к: "k", л: "l", м: "m", н: "n", о: "o",
  п: "p", р: "r", с: "s", т: "t", у: "u", ф: "f", х: "kh", ц: "ts",
  ч: "ch", ш: "sh", щ: "shch", ъ: "", ы: "y", ь: "", э: "e", ю: "yu", я: "ya",
};

function transliterate(text: string): string {
  return (text || "").toLowerCase().split("").map((c) => RU_MAP[c] ?? c).join("");
}

export function slugifyKey(input: string): string {
  const s = transliterate((input || "").trim())
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60);
  return s || "document";
}

export function shortHash(formatId: string): string {
  return (formatId || "").replace(/-/g, "").slice(0, 8) || "00000000";
}

export interface PublicationSlugInput {
  formatId: string;
  typeSlug: string;               // document_types.slug || format_type
  keyword: string | null | undefined; // article main_keyword / title
}

export function buildPublicationSlug(inp: PublicationSlugInput): string {
  const type = slugifyKey(inp.typeSlug || "doc");
  const key = slugifyKey(inp.keyword || "document");
  return `${type}/${key}-${shortHash(inp.formatId)}`;
}

export function pdfStoragePath(userId: string, ecosystemId: string, pubSlug: string): string {
  return `${userId}/${ecosystemId}/${pubSlug}.pdf`;
}