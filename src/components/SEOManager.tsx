import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SiteSettings {
  metrica_id: string | null;
  yandex_verification: string | null;
  google_verification: string | null;
}

export function SEOManager() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    supabase
      .from("site_settings")
      .select("metrica_id, yandex_verification, google_verification")
      .limit(1)
      .maybeSingle()
      .then(({ data, error }) => {
        if (error) {
          console.warn("SEOManager: failed to load site_settings", error.message);
          return;
        }
        if (data) setSettings(data as SiteSettings);
      });
  }, []);

  useEffect(() => {
    if (!settings) return;

    // Yandex verification meta
    const yv = settings.yandex_verification?.trim();
    if (yv) {
      let meta = document.querySelector('meta[name="yandex-verification"]') as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "yandex-verification");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", yv);
    }

    // Google verification meta
    const gv = settings.google_verification?.trim();
    if (gv) {
      let meta = document.querySelector('meta[name="google-site-verification"]') as HTMLMetaElement | null;
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "google-site-verification");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", gv);
    }

    // Yandex.Metrica script — skip on localhost and preview domains
    const mid = settings.metrica_id?.trim();
    const hostname = window.location.hostname;
    const isLocal = hostname === "localhost" || hostname === "127.0.0.1" || hostname.includes(".lovable.app");
    if (mid && !isLocal) {
      if (document.getElementById("ym-script")) return;

      // Declare ym globally
      (window as any).ym = (window as any).ym || function (...args: any[]) {
        ((window as any).ym.a = (window as any).ym.a || []).push(args);
      };
      (window as any).ym.l = Date.now();

      const script = document.createElement("script");
      script.id = "ym-script";
      script.async = true;
      script.src = "https://mc.yandex.ru/metrika/tag.js";
      script.onload = () => {
        (window as any).ym(Number(mid), "init", {
          clickmap: true,
          trackLinks: true,
          accurateTrackBounce: true,
          webvisor: true,
        });
      };
      document.head.appendChild(script);

      // noscript fallback in body
      const noscript = document.createElement("noscript");
      const img = document.createElement("img");
      img.src = `https://mc.yandex.ru/watch/${mid}`;
      img.style.position = "absolute";
      img.style.left = "-9999px";
      img.alt = "";
      noscript.appendChild(img);
      document.body.appendChild(noscript);
    }
  }, [settings]);

  return null;
}
