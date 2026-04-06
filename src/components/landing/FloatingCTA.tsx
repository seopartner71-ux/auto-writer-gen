import { useNavigate } from "react-router-dom";
import { useI18n } from "@/shared/hooks/useI18n";
import { ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";

export function FloatingCTA() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => navigate("/register")}
      className="fixed bottom-6 right-6 z-50 flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-6 py-3 text-sm font-semibold text-white shadow-[0_4px_24px_rgba(139,92,246,0.4)] hover:shadow-[0_4px_32px_rgba(139,92,246,0.6)] hover:scale-105 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4"
    >
      {t("landing.getStarted")}
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}
