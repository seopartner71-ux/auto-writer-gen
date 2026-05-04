import { FileText, Gem, Factory, BookOpen } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { toast } from "sonner";
import MyArticlesPage from "@/pages/MyArticlesPage";
import { useI18n } from "@/shared/hooks/useI18n";

interface Props {
  mode: "single" | "bulk";
  onModeChange: (mode: "single" | "bulk") => void;
  hasBulkMode: boolean;
}

/**
 * Header for the Writer page (mode switcher + "My articles" sheet).
 * Extracted from ArticlesPage.tsx to start splitting the monolith.
 */
export function ArticlesPageHeader({ mode, onModeChange, hasBulkMode }: Props) {
  const { t } = useI18n();

  return (
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
      <Sheet>
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
            <MyArticlesPage />
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}