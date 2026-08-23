import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ExternalLink, Loader2 } from "lucide-react";

type Row = Record<string, any>;

const scoreColor = (v: number) =>
  v >= 70 ? "text-emerald-500" : v >= 30 ? "text-amber-500" : "text-destructive";

export default function ClientPortalPage() {
  const { lang } = useI18n();
  const ru = lang === "ru";
  const [loading, setLoading] = useState(true);
  const [projects, setProjects] = useState<Row[]>([]);
  const [branding, setBranding] = useState<Row | null>(null);

  useEffect(() => {
    (async () => {
      const { data } = await supabase.functions.invoke("network-radar", { body: { action: "client_overview" } });
      setProjects(data?.projects || []);
      setBranding(data?.branding || null);
      setLoading(false);
    })();
  }, []);

  if (loading) {
    return <div className="p-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  }

  return (
    <div className="app-shell p-4 md:p-6 space-y-6 max-w-[1100px] mx-auto">
      <header className="flex items-center gap-3">
        {branding?.logo_url ? <img src={branding.logo_url} alt={branding?.agency_name || "logo"} className="h-8" /> : null}
        <div>
          <h1 className="text-2xl font-semibold">{branding?.agency_name || (ru ? "Кабинет клиента" : "Client cabinet")}</h1>
          <p className="text-sm text-muted-foreground">
            {ru ? "Показатели, статьи и релизы ваших сайтов." : "Performance, articles and releases of your sites."}
          </p>
        </div>
      </header>

      {projects.length === 0 ? (
        <p className="text-sm text-muted-foreground">{ru ? "Доступных проектов нет." : "No projects available."}</p>
      ) : projects.map((p) => {
        const url = p.production_url || (p.custom_domain ? `https://${p.custom_domain}` : (p.domain ? `https://${p.domain}` : null));
        return (
          <Card key={p.id}>
            <CardHeader className="pb-2">
              <CardTitle className="text-base flex items-center gap-2">
                {p.name}
                {url && (
                  <a href={url} target="_blank" rel="noopener noreferrer" className="text-primary text-xs inline-flex items-center gap-1">
                    <ExternalLink className="h-3 w-3" />{url.replace(/^https?:\/\//, "")}
                  </a>
                )}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="grid grid-cols-2 md:grid-cols-5 gap-3 text-sm">
                {[
                  { l: "SEO", v: p.scores?.seo_score },
                  { l: "GEO", v: p.scores?.geo_score },
                  { l: ru ? "Качество" : "Quality", v: p.scores?.quality_score },
                  { l: ru ? "Страниц" : "Pages", v: p.scores?.pages, plain: true },
                  { l: ru ? "Просмотры" : "Views", v: p.total_views, plain: true },
                ].map((m) => (
                  <div key={m.l}>
                    <div className="text-xs text-muted-foreground">{m.l}</div>
                    <div className={`text-xl font-semibold ${m.plain ? "" : scoreColor(Number(m.v || 0))}`}>{m.v ?? "-"}</div>
                  </div>
                ))}
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">{ru ? "Релизы" : "Releases"}</div>
                <div className="flex flex-wrap gap-2">
                  {(p.releases || []).map((r: Row) => (
                    <Badge key={r.version + r.created_at} variant="outline" className="text-[10px]">
                      {r.version} - {new Date(r.created_at).toLocaleDateString("ru-RU")}
                    </Badge>
                  ))}
                  {!(p.releases || []).length && <span className="text-xs text-muted-foreground">-</span>}
                </div>
              </div>

              <div>
                <div className="text-xs text-muted-foreground mb-1">{ru ? "Статьи" : "Articles"}</div>
                <ul className="text-sm space-y-1">
                  {(p.articles || []).slice(0, 10).map((a: Row) => (
                    <li key={a.id} className="truncate">{a.title}</li>
                  ))}
                  {!(p.articles || []).length && <li className="text-xs text-muted-foreground">-</li>}
                </ul>
              </div>
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}
