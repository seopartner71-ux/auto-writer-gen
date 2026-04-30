import DOMPurify from "dompurify";

interface InjectionLink {
  url: string;
  anchor: string;
}

interface Props {
  links: InjectionLink[];
  lang: "ru" | "en" | string;
}

const DEMO_PARAGRAPHS_RU = [
  "В современных условиях правильный выбор подхода к задаче напрямую влияет на итоговый результат и сроки реализации. Опыт показывает, что грамотная подготовка снижает риски и помогает сэкономить бюджет.",
  "При планировании важно учитывать характеристики оборудования, особенности эксплуатации и требования по обслуживанию. Это позволяет получить стабильное качество работы на долгие годы.",
  "Дополнительные материалы, обзоры и подробные руководства помогут разобраться в нюансах глубже и принять обоснованное решение, опираясь на реальные данные и проверенные источники.",
];

const DEMO_PARAGRAPHS_EN = [
  "In modern conditions, the right approach directly affects the final result and the project timeline. Practice shows that proper preparation reduces risks and helps save budget.",
  "When planning, it's important to take into account equipment specs, operating conditions and maintenance requirements. This delivers stable quality of work for years to come.",
  "Additional materials, reviews and detailed guides will help you dive deeper into the nuances and make an informed decision based on real data and trusted sources.",
];

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function buildPreviewHtml(paragraphs: string[], links: InjectionLink[]): string {
  // Mirror server-side logic: 1 link per paragraph, max 3, force-append if anchor not found.
  const paras = paragraphs.map((p) => escapeHtml(p));
  const used = new Set<number>();

  links.slice(0, 3).forEach((link, linkIdx) => {
    const url = (link.url || "").trim();
    const anchor = (link.anchor || "").trim();
    if (!url || !anchor) return;
    const safeAnchor = escapeHtml(anchor);
    const safeUrl = escapeHtml(url);
    const linkHtml = `<a href="${safeUrl}" rel="nofollow noopener" target="_blank" class="injection-preview-link">${safeAnchor}</a>`;

    // Try to find anchor inside an unused paragraph (case-insensitive).
    let placed = false;
    for (let i = 0; i < paras.length; i++) {
      if (used.has(i)) continue;
      const re = new RegExp(`(${anchor.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")})`, "i");
      if (re.test(paras[i])) {
        paras[i] = paras[i].replace(re, linkHtml);
        used.add(i);
        placed = true;
        break;
      }
    }
    if (!placed) {
      // Forced fallback to next free paragraph.
      const idx = linkIdx % paras.length;
      const target = used.has(idx) ? paras.findIndex((_, i) => !used.has(i)) : idx;
      const finalIdx = target >= 0 ? target : idx;
      const trimmed = paras[finalIdx].trim();
      const sep = trimmed.endsWith(".") ? " " : ". ";
      paras[finalIdx] = `${paras[finalIdx]}${sep}${linkHtml}.`;
      used.add(finalIdx);
    }
  });

  return paras.map((p) => `<p>${p}</p>`).join("");
}

export function InjectionLinksPreview({ links, lang }: Props) {
  const paragraphs = lang === "en" ? DEMO_PARAGRAPHS_EN : DEMO_PARAGRAPHS_RU;
  const html = buildPreviewHtml(paragraphs, links);
  const safe = DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ["p", "a"],
    ALLOWED_ATTR: ["href", "rel", "target", "class"],
  });

  return (
    <div
      className="injection-preview text-[11px] leading-relaxed text-foreground/90 space-y-2 [&_p]:m-0 [&_a.injection-preview-link]:text-primary [&_a.injection-preview-link]:underline [&_a.injection-preview-link]:decoration-dotted [&_a.injection-preview-link]:underline-offset-2 [&_a.injection-preview-link]:font-medium [&_a.injection-preview-link]:bg-primary/10 [&_a.injection-preview-link]:px-1 [&_a.injection-preview-link]:rounded-sm"
      dangerouslySetInnerHTML={{ __html: safe }}
    />
  );
}
