import { useState, useEffect } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Cookie } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useI18n } from "@/shared/hooks/useI18n";

export function CookieConsent() {
  const { lang } = useI18n();
  const navigate = useNavigate();
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const accepted = localStorage.getItem("cookie-consent");
    if (!accepted) {
      const timer = setTimeout(() => setVisible(true), 1500);
      return () => clearTimeout(timer);
    }
  }, []);

  const accept = () => {
    localStorage.setItem("cookie-consent", "1");
    setVisible(false);
  };

  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ y: 100, opacity: 0 }}
          animate={{ y: 0, opacity: 1 }}
          exit={{ y: 100, opacity: 0 }}
          transition={{ duration: 0.4, ease: "easeOut" }}
          className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[90%] max-w-lg"
        >
          <div className="rounded-2xl border border-t-white/15 border-l-white/8 border-r-white/4 border-b-white/[0.02] bg-[#0a0a12]/90 backdrop-blur-2xl p-5 shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
            <div className="flex items-start gap-4">
              <div className="w-9 h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                <Cookie className="h-4 w-4 text-primary" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-muted-foreground/80 leading-relaxed">
                  {lang === "ru"
                    ? <>Мы используем файлы cookie для улучшения работы сервиса и анализа трафика. Продолжая использовать сайт, вы соглашаетесь с нашей{" "}
                        <button onClick={() => { accept(); navigate("/cookies"); }} className="text-primary hover:underline">Политикой использования Cookie</button>.</>
                    : <>We use cookies to improve service and analyze traffic. By continuing to use the site, you agree to our{" "}
                        <button onClick={() => { accept(); navigate("/cookies"); }} className="text-primary hover:underline">Cookie Policy</button>.</>
                  }
                </p>
              </div>
              <button
                onClick={accept}
                className="shrink-0 px-5 py-2 rounded-xl bg-primary/20 border border-primary/30 text-sm font-medium text-primary hover:bg-primary/30 transition-colors"
              >
                {lang === "ru" ? "Принять" : "Accept"}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}