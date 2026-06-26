import { useI18n } from "@/shared/hooks/useI18n";
import { ArrowRight } from "lucide-react";
import { useState, useEffect } from "react";

export function FloatingCTA() {
  const { lang } = useI18n();
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
    <a
      href="https://t.me/sin0ptick"
      target="_blank"
      rel="noopener noreferrer"
      className={`fixed right-4 sm:right-6 z-50 flex items-center gap-2 rounded-full bg-primary px-5 sm:px-6 py-2.5 sm:py-3 text-xs sm:text-sm font-semibold text-primary-foreground hover:bg-primary/90 transition-colors duration-200 animate-in fade-in slide-in-from-bottom-4 ${
        cookieVisible ? "bottom-[140px] sm:bottom-6" : "bottom-6"
      }`}
    >
      {lang === "ru" ? "Написать в поддержку" : "Contact Support"}
      <ArrowRight className="h-4 w-4" />
    </a>
  );
}
