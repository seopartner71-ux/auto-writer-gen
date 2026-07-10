import { useMemo } from "react";
import { Card } from "@/components/ui/card";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ListTree, Search } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

interface Heading {
  text: string;
  level: 2 | 3;
  index: number;
}

function parseHeadings(content: string): Heading[] {
  if (!content) return [];
  const out: Heading[] = [];
  const re = /^(#{2,3})\s*(.+)$/gm;
  let m: RegExpExecArray | null;
  while ((m = re.exec(content)) !== null) {
    out.push({
      level: m[1].length === 2 ? 2 : 3,
      text: m[2].trim().replace(/[*_`]/g, ""),
      index: m.index,
    });
  }
  const htmlRe = /<h([23])\b[^>]*>([\s\S]*?)<\/h\1>/gi;
  while ((m = htmlRe.exec(content)) !== null) {
    out.push({
      level: m[1] === "2" ? 2 : 3,
      text: m[2].replace(/<[^>]*>/g, "").trim(),
      index: m.index,
    });
  }
  out.sort((a, b) => a.index - b.index);
  return out;
}

function truncate(s: string, n: number) {
  if (!s) return "";
  return s.length > n ? s.slice(0, n - 1).trim() + "…" : s;
}

interface Props {
  content: string;
  title: string;
  metaDescription: string;
  domain?: string | null;
  slug?: string;
  onJump?: (charIndex: number, text: string) => void;
}

export function EditorSidebar({ content, title, metaDescription, domain, slug, onJump }: Props) {
  const { t } = useI18n();
  const headings = useMemo(() => parseHeadings(content), [content]);

  const seoTitle = title || t("es.titlePlaceholder");
  const seoDesc = metaDescription || (content ? truncate(content.replace(/[#*_`>]/g, "").trim(), 155) : t("es.descPlaceholder"));
  const host = (domain || "example.com").replace(/^https?:\/\//, "").replace(/\/$/, "");
  const path = slug ? `/${slug}` : "/article";

  const titleLen = seoTitle.length;
  const descLen = seoDesc.length;
  const titleColor = titleLen > 60 ? "text-amber-400" : "text-emerald-400";
  const descColor = descLen > 160 ? "text-amber-400" : descLen < 50 ? "text-amber-400" : "text-emerald-400";

  return (
    <div className="space-y-3">
      <Card className="bg-card border-border p-3">
        <div className="flex items-center gap-1.5 mb-2 text-xs font-medium text-muted-foreground">
          <Search className="h-3.5 w-3.5" />
          {t("es.serpPreview")}
        </div>
        <div className="rounded-md bg-background/40 p-3 space-y-1 border border-border/40">
          <div className="text-[11px] text-muted-foreground truncate">{host}{path}</div>
          <div className="text-sm text-blue-400 leading-snug line-clamp-2 hover:underline cursor-default">
            {truncate(seoTitle, 70)}
          </div>
          <div className="text-xs text-muted-foreground/90 leading-snug line-clamp-3">
            {truncate(seoDesc, 165)}
          </div>
        </div>
        <div className="flex items-center justify-between mt-2 text-[10px] font-mono">
          <span className={titleColor}>title {titleLen}/60</span>
          <span className={descColor}>desc {descLen}/160</span>
        </div>
      </Card>

      <Card className="bg-card border-border p-3">
        <div className="flex items-center justify-between mb-2">
          <div className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            <ListTree className="h-3.5 w-3.5" />
            {t("es.structure")}
          </div>
          <span className="text-[10px] font-mono text-muted-foreground">
            {headings.length} {headings.length === 1 ? t("es.block") : t("es.blocks")}
          </span>
        </div>
        {headings.length === 0 ? (
          <div className="text-[11px] text-muted-foreground/60 italic py-2">
            {t("es.headingsAppear")}
          </div>
        ) : (
          <ScrollArea className="max-h-[55vh]">
            <ul className="space-y-0.5 pr-2">
              {headings.map((h, i) => (
                <li key={i}>
                  <button
                    onClick={() => onJump?.(h.index, h.text)}
                    className={`w-full text-left text-xs px-2 py-1 rounded hover:bg-muted/50 transition-colors truncate ${
                      h.level === 2 ? "text-foreground font-medium" : "text-muted-foreground pl-5"
                    }`}
                    title={h.text}
                  >
                    {h.text}
                  </button>
                </li>
              ))}
            </ul>
          </ScrollArea>
        )}
      </Card>
    </div>
  );
}