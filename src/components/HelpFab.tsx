import { HelpCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate, useLocation } from "react-router-dom";
import { useI18n } from "@/shared/hooks/useI18n";

export function HelpFab() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { t } = useI18n();

  // Hide on auth/landing pages
  const hidden = ["/", "/login", "/register", "/forgot-password", "/reset-password", "/wiki"].includes(pathname);
  if (hidden) return null;

  return (
    <Button
      onClick={() => navigate("/wiki")}
      size="icon"
      className="fixed bottom-5 right-5 z-40 h-12 w-12 rounded-full shadow-lg bg-primary text-primary-foreground hover:bg-primary/90"
      title={t("nav.wiki")}
      aria-label={t("nav.wiki")}
    >
      <HelpCircle className="h-6 w-6" />
    </Button>
  );
}