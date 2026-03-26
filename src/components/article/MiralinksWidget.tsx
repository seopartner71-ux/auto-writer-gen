import { useState, useMemo, useEffect } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Link2, ClipboardCopy, ShieldCheck, Plus, Trash2, AlertTriangle } from "lucide-react";
import { toast } from "sonner";

export interface MiralinksLink {
  url: string;
  anchor: string;
}

interface MiralinksWidgetProps {
  content: string;
  title: string;
  metaDescription: string;
  isMiralinksProfile: boolean;
  links: MiralinksLink[];
  onLinksChange: (links: MiralinksLink[]) => void;
  followRules: boolean;
  onFollowRulesChange: (v: boolean) => void;
}

interface CheckResult {
  key: string;
  label: string;
  passed: boolean;
  detail: string;
}

export function MiralinksWidget({
  content, title, metaDescription, isMiralinksProfile,
  links, onLinksChange, followRules, onFollowRulesChange,
}: MiralinksWidgetProps) {
  const [showResults, setShowResults] = useState(false);

  // Auto-show results when Miralinks profile is active
  useEffect(() => {
    if (isMiralinksProfile && content.trim()) setShowResults(true);
  }, [isMiralinksProfile, content]);

  const updateLink = (index: number, field: keyof MiralinksLink, value: string) => {
    onLinksChange(links.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const addLink = () => {
    if (links.length < 3) onLinksChange([...links, { url: "", anchor: "" }]);
  };

  const removeLink = (index: number) => {
    if (links.length > 1) onLinksChange(links.filter((_, i) => i !== index));
  };

  const plainText = useMemo(() => {
    return content
      .replace(/^#{1,6}\s+/gm, "")
      .replace(/\*\*(.+?)\*\*/g, "$1")
      .replace(/\*(.+?)\*/g, "$1")
      .replace(/!\[.*?\]\(.*?\)/g, "")
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, "$1");
  }, [content]);

  const charCount = plainText.replace(/\s/g, "").length;
  const imageMatches = content.match(/!\[([^\]]*)\]\(([^)]+)\)/g) || [];
  const imageCount = imageMatches.length;

  // Check images have alt text with content
  const imagesWithAlt = imageMatches.filter(m => {
    const alt = m.match(/!\[([^\]]*)\]/)?.[1];
    return alt && alt.trim().length > 0;
  }).length;

  // Check if links are NOT in first/last paragraph
  const paragraphs = useMemo(() => {
    return content.split(/\n\n+/).filter(p => p.trim() && !p.trim().startsWith("#"));
  }, [content]);

  const linksInFirstParagraph = useMemo(() => {
    if (paragraphs.length === 0) return false;
    return /\[([^\]]+)\]\(https?:\/\//.test(paragraphs[0]);
  }, [paragraphs]);

  const linksInLastParagraph = useMemo(() => {
    if (paragraphs.length < 2) return false;
    return /\[([^\]]+)\]\(https?:\/\//.test(paragraphs[paragraphs.length - 1]);
  }, [paragraphs]);

  const checks = useMemo<CheckResult[]>(() => {
    const results: CheckResult[] = [];

    // 1. No links in first paragraph
    results.push({
      key: "no_link_first",
      label: "Нет ссылок в 1-м абзаце",
      passed: !linksInFirstParagraph,
      detail: linksInFirstParagraph ? "Найдена ссылка!" : "OK",
    });

    // 2. Length > 2000 chars
    results.push({
      key: "length",
      label: "Длина > 2000 знаков",
      passed: charCount >= 2000,
      detail: `${charCount.toLocaleString()} зн.`,
    });

    // 3. Min 2+ images with alt
    results.push({
      key: "images",
      label: "2+ изображений с Alt",
      passed: imagesWithAlt >= 2,
      detail: `${imagesWithAlt} из ${imageCount} изобр.`,
    });

    // 4. Title and Description
    const hasTitle = title.trim().length > 0;
    const hasDesc = metaDescription.trim().length > 0;
    results.push({
      key: "meta",
      label: "Title и Description",
      passed: hasTitle && hasDesc,
      detail: !hasTitle && !hasDesc ? "Нет обоих" : !hasTitle ? "Нет Title" : !hasDesc ? "Нет Description" : "OK",
    });

    // 5. No links in last paragraph
    results.push({
      key: "no_link_last",
      label: "Нет ссылок в последнем абзаце",
      passed: !linksInLastParagraph,
      detail: linksInLastParagraph ? "Найдена ссылка!" : "OK",
    });

    return results;
  }, [charCount, imagesWithAlt, imageCount, linksInFirstParagraph, linksInLastParagraph, title, metaDescription]);

  const passedCount = checks.filter(c => c.passed).length;
  const allPassed = passedCount === checks.length;

  const handleCopyForMiralinks = () => {
    let html = content;

    html = html
      .replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
      .replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
      .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
      .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
      .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
      .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
      .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
      .replace(/\*(.+?)\*/g, "<em>$1</em>")
      .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" />')
      .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
      .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
      .replace(/(<li>.*<\/li>\n?)+/g, (m) => `<ul>${m}</ul>`)
      .replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>");

    html = html
      .split("\n\n")
      .map((block) => {
        const trimmed = block.trim();
        if (!trimmed) return "";
        if (/^<(h[1-6]|ul|ol|table|blockquote|li|img)/.test(trimmed)) return trimmed;
        return `<p>${trimmed}</p>`;
      })
      .filter(Boolean)
      .join("\n");

    const meta = `<!-- Title: ${title} -->\n<!-- Description: ${metaDescription} -->\n\n`;
    const finalHtml = meta + html;

    navigator.clipboard.writeText(finalHtml).then(() => {
      toast.success("HTML скопирован для Miralinks");
    });
  };

  return (
    <Card className="bg-card border-border">
      <CardHeader className="pb-3">
        <CardTitle className="text-sm flex items-center gap-2">
          <Link2 className="h-4 w-4 text-primary" />
          Miralinks Integration
          {isMiralinksProfile && (
            <Badge variant="default" className="text-[10px] h-5 ml-auto">
              Активен
            </Badge>
          )}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Link pairs */}
        <div className="space-y-3">
          <Label className="text-xs text-muted-foreground font-medium">Ссылки и анкоры</Label>
          {links.map((link, i) => (
            <div key={i} className="space-y-1.5 rounded-md border border-border p-2.5 bg-muted/30">
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-medium text-muted-foreground uppercase tracking-wider">
                  Ссылка {i + 1}
                </span>
                {links.length > 1 && (
                  <button
                    onClick={() => removeLink(i)}
                    className="text-muted-foreground hover:text-destructive transition-colors"
                  >
                    <Trash2 className="h-3 w-3" />
                  </button>
                )}
              </div>
              <Input
                placeholder="https://example.com/page"
                value={link.url}
                onChange={(e) => updateLink(i, "url", e.target.value)}
                className="h-7 text-xs"
              />
              <Input
                placeholder="Текст анкора"
                value={link.anchor}
                onChange={(e) => updateLink(i, "anchor", e.target.value)}
                className="h-7 text-xs"
              />
            </div>
          ))}
          {links.length < 3 && (
            <Button variant="ghost" size="sm" className="w-full h-7 text-xs gap-1" onClick={addLink}>
              <Plus className="h-3 w-3" /> Добавить ссылку
            </Button>
          )}
        </div>

        {/* Follow rules checkbox */}
        <div className="flex items-center gap-2 rounded-md border border-border p-2.5 bg-muted/30">
          <Checkbox
            id="miralinks-rules"
            checked={followRules}
            onCheckedChange={(v) => onFollowRulesChange(!!v)}
          />
          <Label htmlFor="miralinks-rules" className="text-xs cursor-pointer leading-tight">
            Соблюдать правила модерации
            <span className="block text-[10px] text-muted-foreground mt-0.5">
              Ссылки не в первом и последнем абзацах
            </span>
          </Label>
        </div>

        {/* Check button */}
        <Button
          variant="outline"
          size="sm"
          className="w-full gap-1.5"
          onClick={() => setShowResults(true)}
        >
          <ShieldCheck className="h-3.5 w-3.5" />
          Проверить на соответствие
        </Button>

        {/* Real-time compliance checklist */}
        {showResults && (
          <div className="space-y-2 rounded-md border border-border p-3 bg-muted/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Miralinks Compliance</span>
              <Badge
                variant={allPassed ? "default" : "destructive"}
                className="text-[10px] h-5"
              >
                {passedCount}/{checks.length}
              </Badge>
            </div>
            {checks.map((check) => (
              <div key={check.key} className="flex items-center gap-2 text-xs">
                {check.passed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-primary shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}
                <span className={check.passed ? "text-foreground" : "text-destructive"}>
                  {check.label}
                </span>
                <span className="ml-auto text-muted-foreground text-[10px]">{check.detail}</span>
              </div>
            ))}
            {!allPassed && isMiralinksProfile && (
              <div className="flex items-start gap-1.5 mt-2 p-2 rounded bg-destructive/10 text-[10px] text-destructive">
                <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                <span>Статья не пройдёт модерацию Miralinks. Исправьте замечания перед публикацией.</span>
              </div>
            )}
          </div>
        )}

        {/* Copy button */}
        <Button
          size="sm"
          className="w-full gap-1.5"
          onClick={handleCopyForMiralinks}
          disabled={!content.trim()}
        >
          <ClipboardCopy className="h-3.5 w-3.5" />
          Копировать для Miralinks
        </Button>
      </CardContent>
    </Card>
  );
}
