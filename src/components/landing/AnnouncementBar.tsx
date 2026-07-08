import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import { useI18n } from "@/shared/hooks/useI18n";

const STORAGE_KEY = "announcement_closed";

export function AnnouncementBar() {
  const { lang } = useI18n();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(sessionStorage.getItem(STORAGE_KEY) !== "true");
  }, []);

  // expose the bar height as a CSS var so the nav can shift down
  useEffect(() => {
    const root = document.documentElement;
    if (!open) {
      root.style.setProperty("--announcement-h", "0px");
      return;
    }
    const el = ref.current;
    if (!el) return;
    const update = () => root.style.setProperty("--announcement-h", `${el.offsetHeight}px`);
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el);
    window.addEventListener("resize", update);
    return () => {
      ro.disconnect();
      window.removeEventListener("resize", update);
      root.style.setProperty("--announcement-h", "0px");
    };
  }, [open]);

  if (!open) return null;

  const close = () => {
    sessionStorage.setItem(STORAGE_KEY, "true");
    setOpen(false);
  };

  const isRu = lang === "ru";

  return (
    <div
      ref={ref}
      className="fixed top-0 left-0 right-0 z-[60] w-full bg-[#2a1758] text-white border-b border-white/10"
      role="region"
      aria-label="Announcement"
    >
      <div className="relative mx-auto flex min-h-[40px] items-center justify-center px-10 py-2 text-center text-[12px] leading-snug md:text-[13px]">
        <p className="m-0">
          <span aria-hidden>🔒</span>{" "}
          {isRu ? (
            <>
              Места на июль заняты · Запись на август открыта - осталось 5 мест ·{" "}
              <a
                href="https://t.me/sin0ptick"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 font-semibold hover:text-white/90"
              >
                Написать в поддержку →
              </a>
            </>
          ) : (
            <>
              June is fully booked · 5 spots left for July ·{" "}
              <a
                href="https://t.me/sin0ptick"
                target="_blank"
                rel="noopener noreferrer"
                className="underline underline-offset-2 font-semibold hover:text-white/90"
              >
                Contact Support →
              </a>
            </>
          )}
        </p>
        <button
          type="button"
          onClick={close}
          aria-label={isRu ? "Закрыть" : "Close"}
          className="absolute right-2 top-1/2 -translate-y-1/2 p-1.5 rounded-full text-white/80 hover:text-white hover:bg-white/10 transition-colors"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}