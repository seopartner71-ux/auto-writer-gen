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
          className="fixed bottom-0 left-0 right-0 z-[60] sm:bottom-6 sm:left-1/2 sm:-translate-x-1/2 sm:w-[90%] sm:max-w-lg"
        >
          <div className="border-t border-white/10 sm:border sm:rounded-2xl sm:border-t-white/15 sm:border-l-white/8 sm:border-r-white/4 sm:border-b-white/[0.02] bg-[#0a0a12]/95 backdrop-blur-2xl p-4 sm:p-5 shadow-[0_-10px_40px_rgba(0,0,0,0.5)] sm:shadow-[0_20px_60px_rgba(0,0,0,0.6)]">
            <div className="flex flex-col sm:flex-row items-start gap-3 sm:gap-4">
              <div className="flex items-start gap-3 flex-1">
                <div className="w-8 h-8 sm:w-9 sm:h-9 rounded-xl bg-primary/10 border border-primary/20 flex items-center justify-center shrink-0">
                  <Cookie className="h-3.5 w-3.5 sm:h-4 sm:w-4 text-primary" />
                </div>
                <p className="text-xs sm:text-sm text-muted-foreground/80 leading-relaxed">
                  {lang === "ru"
                    ? <>Мы используем cookie для улучшения работы сервиса.{" "}
                        <button onClick={() => { accept(); navigate("/cookies"); }} className="text-primary hover:underline">Подробнее</button></>
                    : <>We use cookies to improve service.{" "}
                        <button onClick={() => { accept(); navigate("/cookies"); }} className="text-primary hover:underline">Learn more</button></>
                  }
                </p>
              </div>
              <button
                onClick={accept}
                className="shrink-0 w-full sm:w-auto px-5 py-2 rounded-xl bg-primary/20 border border-primary/30 text-sm font-medium text-primary hover:bg-primary/30 transition-colors text-center"
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
