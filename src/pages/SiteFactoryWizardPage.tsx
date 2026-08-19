import { Link } from "react-router-dom";
import { useI18n } from "@/shared/hooks/useI18n";
import { Button } from "@/components/ui/button";
import { ArrowLeft } from "lucide-react";
import { SiteFactoryWizard } from "@/features/site-commerce/wizard/SiteFactoryWizard";

export default function SiteFactoryWizardPage() {
  const { lang } = useI18n();
  const ru = lang === "ru";

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            {ru ? "Фабрика сайтов - мастер" : "Site Factory - wizard"}
          </h1>
          <p className="text-sm text-muted-foreground">
            {ru
              ? "Семантика, SILO, товары, контент, QA, превью и публикация - в одном потоке."
              : "Semantics, SILO, products, content, QA, preview and deploy in one flow."}
          </p>
        </div>
        <Button asChild variant="outline" size="sm">
          <Link to="/site-factory"><ArrowLeft className="h-4 w-4 mr-2" />{ru ? "К Фабрике" : "Back to factory"}</Link>
        </Button>
      </div>
      <SiteFactoryWizard lang={lang} />
    </div>
  );
}