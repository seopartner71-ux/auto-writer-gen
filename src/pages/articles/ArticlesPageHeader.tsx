import { useEffect, useState } from "react";
import { FileText, Gem, Factory, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { toast } from "sonner";
import MyArticlesPage from "@/pages/MyArticlesPage";
import { useI18n } from "@/shared/hooks/useI18n";

interface Props {
  mode: "single" | "bulk";
  onModeChange: (mode: "single" | "bulk") => void;
  hasBulkMode: boolean;
  aiwriterMode?: "quick" | "expert";
  onAiwriterModeChange?: (m: "quick" | "expert") => void;
}

/**
 * Header for the Writer page (mode switcher + "My articles" sheet).
 * Extracted from ArticlesPage.tsx to start splitting the monolith.
 */
export function ArticlesPageHeader({ mode, onModeChange, hasBulkMode, aiwriterMode, onAiwriterModeChange }: Props) {
  const { t } = useI18n();
  const [openMyArticles, setOpenMyArticles] = useState(false);
  const [hintOpen, setHintOpen] = useState(false);

  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!aiwriterMode || mode !== "single") return;
    try {
      const seen = localStorage.getItem("aiwriter_mode_hint_shown");
      if (seen !== "true") {
        const t = setTimeout(() => setHintOpen(true), 600);
        return () => clearTimeout(t);
      }
    } catch { /* ignore */ }
  }, [aiwriterMode, mode]);

  const dismissHint = () => {
    setHintOpen(false);
    try { localStorage.setItem("aiwriter_mode_hint_shown", "true"); } catch { /* ignore */ }
  };

  return (
    <div className="space-y-3">
    <div className="flex items-center gap-3">
      <FileText className="h-6 w-6 text-primary" />
      <div>
        <h1 className="text-2xl font-semibold">{t("articles.title")}</h1>
        <p className="text-sm text-muted-foreground">{t("articles.subtitle")}</p>
      </div>
      <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
        <Button
          variant={mode === "single" ? "default" : "ghost"}
          size="sm"
          onClick={() => onModeChange("single")}
          className="gap-1.5 text-xs"
        >
          <Gem className="h-3.5 w-3.5" />
          Boutique
        </Button>
        <Button
          variant={mode === "bulk" ? "default" : "ghost"}
          size="sm"
          onClick={() => {
            if (!hasBulkMode) {
              toast.error(t("articles.bulkProOnly"));
              return;
            }
            onModeChange("bulk");
          }}
          className="gap-1.5 text-xs"
        >
          <Factory className="h-3.5 w-3.5" />
          Factory
          {!hasBulkMode && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">PRO</Badge>}
        </Button>
      </div>
      <Sheet open={openMyArticles} onOpenChange={setOpenMyArticles}>
        <SheetTrigger asChild>
          <Button variant="outline" size="sm" className="gap-1.5">
            <BookOpen className="h-3.5 w-3.5" />
            {t("nav.myArticles")}
          </Button>
        </SheetTrigger>
        <SheetContent side="right" className="w-full sm:max-w-3xl overflow-y-auto">
          <SheetHeader>
            <SheetTitle>{t("nav.myArticles")}</SheetTitle>
          </SheetHeader>
          <div className="mt-4">
            <MyArticlesPage onArticleSelect={() => setOpenMyArticles(false)} />
          </div>
        </SheetContent>
      </Sheet>
    </div>
      {aiwriterMode && onAiwriterModeChange && mode === "single" && (
        <Popover open={hintOpen} onOpenChange={(o) => { if (!o) dismissHint(); }}>
          <PopoverTrigger asChild>
            <div className="inline-flex items-center gap-1 rounded-full border border-border bg-muted/40 p-1">
              <button
            type="button"
            onClick={() => onAiwriterModeChange("quick")}
            className={`min-w-[160px] px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              aiwriterMode === "quick"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            🚀 Быстрый старт
          </button>
          <button
            type="button"
            onClick={() => onAiwriterModeChange("expert")}
            className={`min-w-[160px] px-4 py-1.5 rounded-full text-xs font-medium transition-colors ${
              aiwriterMode === "expert"
                ? "bg-primary text-primary-foreground shadow"
                : "text-muted-foreground hover:text-foreground"
            }`}
          >
            ⚙️ Эксперт
          </button>
            </div>
          </PopoverTrigger>
          <PopoverContent side="bottom" align="start" className="w-80 p-4 space-y-3">
            <div className="text-sm font-semibold">👋 Два режима работы</div>
            <div className="space-y-2 text-xs text-muted-foreground">
              <div>
                <span className="text-foreground font-medium">🚀 Быстрый старт</span> — минимум настроек.
                Просто выберите тему и жмите Generate.
              </div>
              <div>
                <span className="text-foreground font-medium">⚙️ Эксперт</span> — полный контроль:
                SEO настройки, авторский стиль, детальные метрики.
              </div>
            </div>
            <Button size="sm" className="w-full" onClick={dismissHint}>Понятно!</Button>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}