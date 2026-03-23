import { Hexagon } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

export function LandingFooter() {
  const { t } = useI18n();

  return (
    <footer className="border-t border-border/50 bg-background">
      <div className="container mx-auto px-4 py-8 flex flex-col sm:flex-row items-center justify-between gap-4">
        <div className="flex items-center gap-2">
          <Hexagon className="h-4 w-4 text-primary" />
          <span className="text-sm font-brand tracking-tight">SERP<span className="gradient-text">blueprint</span></span>
        </div>
        <p className="text-xs text-muted-foreground text-center">
          © {new Date().getFullYear()} SERPblueprint. {t("landing.copyright")}
        </p>
      </div>
    </footer>
  );
}
