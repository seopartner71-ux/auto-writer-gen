import { useState, useMemo, useEffect, useCallback } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Link2, ClipboardCopy, ShieldCheck, Plus, Trash2, AlertTriangle, Download, Copy, Check } from "lucide-react";
import { toast } from "sonner";
import { Document, Packer, Paragraph, TextRun, HeadingLevel, ExternalHyperlink } from "docx";
import { saveAs } from "file-saver";

export interface GoGetLinksLink {
  url: string;
  anchor: string;
}

interface GoGetLinksWidgetProps {
  content: string;
  title: string;
  metaDescription: string;
  isGoGetLinksProfile: boolean;
  links: GoGetLinksLink[];
  onLinksChange: (links: GoGetLinksLink[]) => void;
  followRules: boolean;
  onFollowRulesChange: (v: boolean) => void;
}

interface CheckResult {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

// ─── Markdown → Clean HTML ───
function markdownToCleanHtml(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let inList = false;
  let listType = "";

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      continue;
    }
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      const level = hMatch[1].length;
      result.push(`<h${level}>${inlineFormat(hMatch[2])}</h${level}>`);
      continue;
    }
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      if (!inList || listType !== "ul") {
        if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
        result.push("<ul>"); inList = true; listType = "ul";
      }
      result.push(`<li>${inlineFormat(ulMatch[1])}</li>`);
      continue;
    }
    const olMatch = trimmed.match(/^\d+\.\s+(.+)$/);
    if (olMatch) {
      if (!inList || listType !== "ol") {
        if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
        result.push("<ol>"); inList = true; listType = "ol";
      }
      result.push(`<li>${inlineFormat(olMatch[1])}</li>`);
      continue;
    }
    if (/^<(table|ul|ol|\/table|\/ul|\/ol)/.test(trimmed)) {
      if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
      result.push(trimmed);
      continue;
    }
    if (inList) { result.push(listType === "ul" ? "</ul>" : "</ol>"); inList = false; }
    result.push(`<p>${inlineFormat(trimmed)}</p>`);
  }
  if (inList) result.push(listType === "ul" ? "</ul>" : "</ol>");
  return result.join("\n");
}

function inlineFormat(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
}

// ─── Markdown → DOCX ───
async function generateDocx(md: string, title: string): Promise<void> {
  const lines = md.split("\n");
  const children: Paragraph[] = [];

  if (title) {
    children.push(new Paragraph({
      heading: HeadingLevel.TITLE,
      children: [new TextRun({ text: title, bold: true, size: 32 })],
    }));
  }

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    const hMatch = trimmed.match(/^(#{1,6})\s+(.+)$/);
    if (hMatch) {
      const levelMap: Record<number, typeof HeadingLevel[keyof typeof HeadingLevel]> = {
        1: HeadingLevel.HEADING_1, 2: HeadingLevel.HEADING_2, 3: HeadingLevel.HEADING_3,
      };
      children.push(new Paragraph({
        heading: levelMap[hMatch[1].length] || HeadingLevel.HEADING_3,
        children: [new TextRun({ text: hMatch[2], bold: true })],
      }));
      continue;
    }
    const imgMatch = trimmed.match(/^!\[([^\]]*)\]\(([^)]+)\)$/);
    if (imgMatch) {
      children.push(new Paragraph({ children: [new TextRun({ text: `[Изображение: ${imgMatch[1] || "image"}]`, italics: true, color: "666666" })] }));
      continue;
    }
    const ulMatch = trimmed.match(/^[-*+]\s+(.+)$/);
    if (ulMatch) {
      children.push(new Paragraph({ bullet: { level: 0 }, children: parseInlineRuns(ulMatch[1]) }));
      continue;
    }
    children.push(new Paragraph({ children: parseInlineRuns(trimmed), spacing: { after: 120 } }));
  }

  const doc = new Document({
    styles: { default: { document: { run: { font: "Arial", size: 24 } } } },
    sections: [{ properties: { page: { size: { width: 12240, height: 15840 }, margin: { top: 1440, right: 1440, bottom: 1440, left: 1440 } } }, children }],
  });

  const buffer = await Packer.toBlob(doc);
  saveAs(buffer, `${(title || "article").replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]/g, "_")}.docx`);
}

function parseInlineRuns(text: string): (TextRun | ExternalHyperlink)[] {
  const runs: (TextRun | ExternalHyperlink)[] = [];
  const parts = text.split(/(\*\*[^*]+\*\*|\*[^*]+\*|\[[^\]]+\]\([^)]+\))/g);
  for (const part of parts) {
    if (!part) continue;
    const boldMatch = part.match(/^\*\*(.+)\*\*$/);
    if (boldMatch) { runs.push(new TextRun({ text: boldMatch[1], bold: true })); continue; }
    const italicMatch = part.match(/^\*(.+)\*$/);
    if (italicMatch) { runs.push(new TextRun({ text: italicMatch[1], italics: true })); continue; }
    const linkMatch = part.match(/^\[([^\]]+)\]\(([^)]+)\)$/);
    if (linkMatch) {
      runs.push(new ExternalHyperlink({ children: [new TextRun({ text: linkMatch[1], style: "Hyperlink" })], link: linkMatch[2] }));
      continue;
    }
    runs.push(new TextRun(part));
  }
  return runs;
}

export function GoGetLinksWidget({
  content, title, metaDescription, isGoGetLinksProfile,
  links, onLinksChange, followRules, onFollowRulesChange,
}: GoGetLinksWidgetProps) {
  const [showResults, setShowResults] = useState(false);
  const [titleCopied, setTitleCopied] = useState(false);
  const [descCopied, setDescCopied] = useState(false);

  useEffect(() => {
    if (isGoGetLinksProfile && content.trim()) setShowResults(true);
  }, [isGoGetLinksProfile, content]);

  const updateLink = (index: number, field: keyof GoGetLinksLink, value: string) => {
    onLinksChange(links.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };
  const addLink = () => { if (links.length < 3) onLinksChange([...links, { url: "", anchor: "" }]); };
  const removeLink = (index: number) => { if (links.length > 1) onLinksChange(links.filter((_, i) => i !== index)); };

  const plainText = useMemo(() => content
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/\*\*(.+?)\*\*/g, "$1").replace(/\*(.+?)\*/g, "$1")
    .replace(/!\[.*?\]\(.*?\)/g, "").replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1"), [content]);

  const wordCount = useMemo(() => plainText.trim().split(/\s+/).filter(Boolean).length, [plainText]);
  const charCount = plainText.replace(/\s/g, "").length;
  const imageMatches = content.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || [];
  const imageCount = imageMatches.length;

  const paragraphs = useMemo(() => content.split(/\n\n+/).filter(p => p.trim() && !p.trim().startsWith("#")), [content]);
  const linksInFirstParagraph = useMemo(() => paragraphs.length > 0 && /\[([^\]]+)\]\(https?:\/\//.test(paragraphs[0]), [paragraphs]);
  const linksInLastParagraph = useMemo(() => paragraphs.length > 1 && /\[([^\]]+)\]\(https?:\/\//.test(paragraphs[paragraphs.length - 1]), [paragraphs]);

  const titleLen = title.trim().length;
  const descLen = metaDescription.trim().length;
  const titleOk = titleLen >= 50 && titleLen <= 70;
  const descOk = descLen >= 120 && descLen <= 160;

  // GoGetLinks specific checks
  const checks = useMemo<CheckResult[]>(() => [
    { key: "no_link_first", label: "Нет ссылок в 1-м абзаце", passed: !linksInFirstParagraph, detail: linksInFirstParagraph ? "Найдена ссылка!" : "OK" },
    { key: "no_link_last", label: "Нет ссылок в последнем абзаце", passed: !linksInLastParagraph, detail: linksInLastParagraph ? "Найдена ссылка!" : "OK" },
    { key: "length", label: "Длина > 2000 знаков", passed: charCount >= 2000, detail: `${charCount.toLocaleString()} зн.` },
    { key: "words", label: "Минимум 300 слов", passed: wordCount >= 300, detail: `${wordCount} слов` },
    { key: "images", label: "1+ изображение", passed: imageCount >= 1, detail: `${imageCount} изобр.` },
    { key: "title_seo", label: "Title (50-70 символов)", passed: titleOk, detail: titleLen > 0 ? `${titleLen} сим.` : "Нет Title" },
    { key: "desc_seo", label: "Description (120-160 символов)", passed: descOk, detail: descLen > 0 ? `${descLen} сим.` : "Нет Description" },
  ], [charCount, wordCount, imageCount, linksInFirstParagraph, linksInLastParagraph, titleLen, titleOk, descLen, descOk]);

  const passedCount = checks.filter(c => c.passed).length;
  const allPassed = passedCount === checks.length;

  const handleCopyHtml = useCallback(() => {
    const html = markdownToCleanHtml(content);
    navigator.clipboard.writeText(html).then(() => toast.success("Чистый HTML скопирован для GoGetLinks"));
  }, [content]);

  const handleDownloadDocx = useCallback(async () => {
    try {
      await generateDocx(content, title);
      toast.success("Файл .docx скачан");
    } catch (e) {
      toast.error("Ошибка генерации .docx");
      console.error(e);
    }
  }, [content, title]);

  const copyField = useCallback((text: string, field: "title" | "desc") => {
    navigator.clipboard.writeText(text);
    if (field === "title") { setTitleCopied(true); setTimeout(() => setTitleCopied(false), 2000); }
    else { setDescCopied(true); setTimeout(() => setDescCopied(false), 2000); }
    toast.success("Скопировано");
  }, []);

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          GoGetLinks Integration
          {isGoGetLinksProfile && (
            <Badge variant="default" className="text-[10px] h-5 ml-auto">Активен</Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* Link pairs */}
        <div className="space-y-2">
          <Label className="text-[10px] text-muted-foreground font-medium uppercase tracking-wider">Ссылки и анкоры</Label>
          {links.map((link, i) => (
            <div key={i} className="space-y-1 rounded-md border border-border p-2 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground">Ссылка {i + 1}</span>
                {links.length > 1 && (
                  <button onClick={() => removeLink(i)} className="text-muted-foreground hover:text-destructive transition-colors">
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Input placeholder="https://example.com/page" value={link.url} onChange={(e) => updateLink(i, "url", e.target.value)} className="h-7 text-xs" />
              <Input placeholder="Текст анкора" value={link.anchor} onChange={(e) => updateLink(i, "anchor", e.target.value)} className="h-7 text-xs" />
            </div>
          ))}
          {links.length < 3 && (
            <Button variant="ghost" size="sm" className="w-full h-7 text-xs gap-1" onClick={addLink}>
              <Plus className="h-3 w-3" /> Добавить ссылку
            </Button>
          )}
        </div>

        {/* Follow rules */}
        <div className="flex items-center gap-2 rounded-md border border-border p-2 bg-muted/30">
          <Checkbox id="gogetlinks-rules" checked={followRules} onCheckedChange={(v) => onFollowRulesChange(!!v)} />
          <Label htmlFor="gogetlinks-rules" className="text-xs cursor-pointer leading-tight">
            Соблюдать правила GoGetLinks
            <span className="block text-[10px] text-muted-foreground mt-0.5">Контекстные ссылки, естественное размещение</span>
          </Label>
        </div>

        {/* Check button */}
        <Button variant="outline" size="sm" className="w-full gap-1.5" onClick={() => setShowResults(true)}>
          <ShieldCheck className="h-3.5 w-3.5" />
          Проверить на соответствие
        </Button>

        {/* Compliance checklist */}
        {showResults && (
          <div className="space-y-1.5 rounded-md border border-border p-2.5 bg-muted/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">GoGetLinks Compliance</span>
              <Badge variant={allPassed ? "default" : "destructive"} className="text-[10px] h-5">
                {passedCount}/{checks.length}
              </Badge>
            </div>
            {checks.map((check) => (
              <div key={check.key} className="flex items-center gap-2 text-xs">
                {check.passed ? <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" /> : <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />}
                <span className={check.passed ? "text-foreground" : "text-destructive"}>{check.label}</span>
                <span className="ml-auto text-muted-foreground text-[10px]">{check.detail}</span>
              </div>
            ))}
            {!allPassed && isGoGetLinksProfile && (
              <div className="flex items-start gap-1.5 mt-1.5 p-2 rounded bg-destructive/10 text-[10px] text-destructive">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>Статья не пройдёт модерацию GoGetLinks. Исправьте замечания.</span>
              </div>
            )}
          </div>
        )}

        {/* Meta Data for copy */}
        {(title || metaDescription) && (
          <div className="space-y-1.5 rounded-md border border-border p-2.5 bg-muted/20">
            <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">Meta Data</span>
            {title && (
              <div className="flex items-center justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground">Title</p>
                  <p className="text-xs truncate">{title}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => copyField(title, "title")}>
                  {titleCopied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            )}
            {metaDescription && (
              <div className="flex items-center justify-between gap-1">
                <div className="flex-1 min-w-0">
                  <p className="text-[10px] text-muted-foreground">Description</p>
                  <p className="text-xs truncate">{metaDescription}</p>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 shrink-0" onClick={() => copyField(metaDescription, "desc")}>
                  {descCopied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                </Button>
              </div>
            )}
          </div>
        )}

        {/* Export buttons */}
        <div className="grid grid-cols-2 gap-2">
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleCopyHtml} disabled={!content.trim()}>
            <ClipboardCopy className="h-3.5 w-3.5" />
            Clean HTML
          </Button>
          <Button size="sm" variant="outline" className="gap-1.5 text-xs" onClick={handleDownloadDocx} disabled={!content.trim()}>
            <Download className="h-3.5 w-3.5" />
            .docx
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
