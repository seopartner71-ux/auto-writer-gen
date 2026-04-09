import { useNavigate } from "react-router-dom";
import { useI18n } from "@/shared/hooks/useI18n";
import { ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";

export function FloatingCTA() {
  const navigate = useNavigate();
  const { t } = useI18n();
  const [visible, setVisible] = useState(false);
  const [cookieVisible, setCookieVisible] = useState(false);

  useEffect(() => {
    setCookieVisible(!localStorage.getItem("cookie-consent"));
  }, []);

  useEffect(() => {
    const onScroll = () => {
      setVisible(window.scrollY > 600);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Listen for cookie acceptance
  useEffect(() => {
    const onStorage = () => {
      if (localStorage.getItem("cookie-consent")) setCookieVisible(false);
    };
    window.addEventListener("storage", onStorage);
    const interval = setInterval(() => {
      if (localStorage.getItem("cookie-consent")) setCookieVisible(false);
    }, 1000);
    return () => { window.removeEventListener("storage", onStorage); clearInterval(interval); };
  }, []);

  if (!visible) return null;

  return (
    <button
      onClick={() => navigate("/register")}
      className={`fixed right-4 sm:right-6 z-50 flex items-center gap-2 rounded-full bg-gradient-to-r from-primary to-[#3b82f6] px-5 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-white shadow-[0_4px_24px_rgba(139,92,246,0.4)] hover:shadow-[0_4px_32px_rgba(139,92,246,0.6)] hover:scale-105 transition-all duration-300 animate-in fade-in slide-in-from-bottom-4 ${
        cookieVisible ? "bottom-[72px] sm:bottom-6" : "bottom-6"
      }`}
    >
      {t("landing.getStarted")}
      <ArrowRight className="h-4 w-4" />
    </button>
  );
}
