import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

interface SiteSettings {
  metrica_id: string;
  yandex_verification: string;
  google_verification: string;
}

export function SEOManager() {
  const [settings, setSettings] = useState<SiteSettings | null>(null);

  useEffect(() => {
    supabase
      .from("site_settings")
      .select("metrica_id, yandex_verification, google_verification")
      .limit(1)
      .single()
      .then(({ data }) => {
        if (data) setSettings(data as SiteSettings);
      });
  }, []);

  useEffect(() => {
    if (!settings) return;

    // Yandex verification meta
    if (settings.yandex_verification) {
      let meta = document.querySelector('meta[name="yandex-verification"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "yandex-verification");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", settings.yandex_verification);
    }

    // Google verification meta
    if (settings.google_verification) {
      let meta = document.querySelector('meta[name="google-site-verification"]');
      if (!meta) {
        meta = document.createElement("meta");
        meta.setAttribute("name", "google-site-verification");
        document.head.appendChild(meta);
      }
      meta.setAttribute("content", settings.google_verification);
    }

    // Yandex.Metrica script — skip on localhost
    if (settings.metrica_id && !window.location.hostname.includes("localhost")) {
      const id = settings.metrica_id;
      if (document.getElementById("ym-script")) return;

      const script = document.createElement("script");
      script.id = "ym-script";
      script.async = true;
      script.textContent = `
        (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
        m[i].l=1*new Date();
        for(var j=0;j<document.scripts.length;j++){if(document.scripts[j].src===r)return;}
        k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
        (window,document,"script","https://mc.yandex.ru/metrika/tag.js","ym");
        ym(${id},"init",{clickmap:true,trackLinks:true,accurateTrackBounce:true,webvisor:true});
      `;
      document.head.appendChild(script);

      // noscript fallback in body
      const noscript = document.createElement("noscript");
      const img = document.createElement("img");
      img.src = `https://mc.yandex.ru/watch/${id}`;
      img.style.position = "absolute";
      img.style.left = "-9999px";
      img.alt = "";
      noscript.appendChild(img);
      document.body.appendChild(noscript);
    }
  }, [settings]);

  return null;
}
