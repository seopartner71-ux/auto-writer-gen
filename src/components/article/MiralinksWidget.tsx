import { useState, useMemo } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { CheckCircle2, XCircle, Link2, ClipboardCopy, ShieldCheck, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface LinkPair {
  url: string;
  anchor: string;
}

interface MiralinksWidgetProps {
  content: string;
  title: string;
  metaDescription: string;
}

interface CheckResult {
  label: string;
  passed: boolean;
  detail: string;
}

export function MiralinksWidget({ content, title, metaDescription }: MiralinksWidgetProps) {
  const [links, setLinks] = useState<LinkPair[]>([{ url: "", anchor: "" }]);
  const [followRules, setFollowRules] = useState(true);
  const [showResults, setShowResults] = useState(false);

  const updateLink = (index: number, field: keyof LinkPair, value: string) => {
    setLinks((prev) => prev.map((l, i) => (i === index ? { ...l, [field]: value } : l)));
  };

  const addLink = () => {
    if (links.length < 3) setLinks((prev) => [...prev, { url: "", anchor: "" }]);
  };

  const removeLink = (index: number) => {
    if (links.length > 1) setLinks((prev) => prev.filter((_, i) => i !== index));
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
  const imageCount = (content.match(/!\[.*?\]\(.*?\)/g) || []).length;

  const checks = useMemo<CheckResult[]>(() => {
    const results: CheckResult[] = [];

    // 1. Length > 2000 chars
    results.push({
      label: "Длина > 2000 знаков",
      passed: charCount >= 2000,
      detail: `${charCount.toLocaleString()} зн.`,
    });

    // 2. Min 2-3 images
    results.push({
      label: "Минимум 2-3 изображения",
      passed: imageCount >= 2,
      detail: `${imageCount} изобр.`,
    });

    // 3. Links in center of text (not in first/last paragraph)
    const filledLinks = links.filter((l) => l.url.trim() && l.anchor.trim());
    if (filledLinks.length === 0) {
      results.push({
        label: "Ссылки в центре текста",
        passed: false,
        detail: "Нет ссылок",
      });
    } else {
      // Check if followRules is on — links should avoid first/last paragraphs
      results.push({
        label: "Ссылки в центре текста",
        passed: followRules,
        detail: followRules ? "Правило активно" : "Правило отключено",
      });
    }

    // 4. Title and Description
    const hasTitle = title.trim().length > 0;
    const hasDesc = metaDescription.trim().length > 0;
    results.push({
      label: "Наличие Title и Description",
      passed: hasTitle && hasDesc,
      detail: !hasTitle && !hasDesc
        ? "Нет Title и Description"
        : !hasTitle
        ? "Нет Title"
        : !hasDesc
        ? "Нет Description"
        : "OK",
    });

    return results;
  }, [charCount, imageCount, links, followRules, title, metaDescription]);

  const allPassed = checks.every((c) => c.passed);

  const handleCopyForMiralinks = () => {
    // Build clean HTML with links injected
    let html = content;

    // Simple markdown to clean HTML for Miralinks
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

    // Wrap paragraphs
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

    // Prepend Title + Description
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
            onCheckedChange={(v) => setFollowRules(!!v)}
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
          Проверить на соответствие правилам
        </Button>

        {/* Results */}
        {showResults && (
          <div className="space-y-2 rounded-md border border-border p-3 bg-muted/20">
            <div className="flex items-center justify-between mb-1">
              <span className="text-xs font-medium">Результаты проверки</span>
              <Badge
                variant={allPassed ? "default" : "destructive"}
                className="text-[10px] h-5"
              >
                {allPassed ? "Готово" : "Есть замечания"}
              </Badge>
            </div>
            {checks.map((check, i) => (
              <div key={i} className="flex items-center gap-2 text-xs">
                {check.passed ? (
                  <CheckCircle2 className="h-3.5 w-3.5 text-emerald-500 shrink-0" />
                ) : (
                  <XCircle className="h-3.5 w-3.5 text-destructive shrink-0" />
                )}
                <span className={check.passed ? "text-foreground" : "text-destructive"}>
                  {check.label}
                </span>
                <span className="ml-auto text-muted-foreground text-[10px]">{check.detail}</span>
              </div>
            ))}
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
