// P20 - Media Engine UI (wizard step "Изображения").
// Presentation layer only: all generation happens in the media-engine function.
import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toast } from "sonner";
import { Images, Loader2, RefreshCw, Download, Sparkles } from "lucide-react";

interface MediaStats {
  products_total: number;
  products_with_photo: number;
  products_without_photo: number;
  products_own_photo: number;
  categories_total: number;
  categories_with_photo: number;
  articles_total: number;
  articles_with_cover: number;
  images_total: number;
  ai: number;
  imported: number;
  placeholder: number;
  failed: number;
  no_alt: number;
}

interface AssetRow {
  id: string;
  entity_type: string;
  image_type: string;
  image_url: string;
  alt: string;
  source: string;
  status: string;
}

const SCOPES = ["all", "products", "categories", "articles"] as const;

export function MediaPanel({ projectId, ru }: { projectId: string; ru: boolean }) {
  const [stats, setStats] = useState<MediaStats | null>(null);
  const [assets, setAssets] = useState<AssetRow[]>([]);
  const [scope, setScope] = useState<string>("all");
  const [busy, setBusy] = useState<string>("");
  const [progress, setProgress] = useState(0);

  const call = useCallback(async (body: Record<string, unknown>) => {
    const { data, error } = await supabase.functions.invoke("media-engine", {
      body: { project_id: projectId, ...body },
    });
    if (error) throw new Error(error.message);
    if (data?.error) throw new Error(String(data.error));
    return data as { stats?: MediaStats; remaining?: number; generated?: number; imported?: number; failed?: number };
  }, [projectId]);

  const loadAssets = useCallback(async () => {
    const { data } = await supabase
      .from("image_assets")
      .select("id, entity_type, image_type, image_url, alt, source, status")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false })
      .limit(24);
    setAssets((data || []) as AssetRow[]);
  }, [projectId]);

  const refresh = useCallback(async () => {
    try {
      const d = await call({ mode: "stats" });
      if (d.stats) setStats(d.stats);
      await loadAssets();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }, [call, loadAssets]);

  useEffect(() => { if (projectId) void refresh(); }, [projectId, refresh]);

  const run = async (mode: string, label: string) => {
    setBusy(mode);
    setProgress(0);
    try {
      let remaining = 1;
      let guard = 0;
      let generated = 0;
      while (remaining > 0 && guard < 40) {
        const d = await call({ mode, scope: [scope] });
        if (d.stats) setStats(d.stats);
        generated += Number(d.generated || 0);
        remaining = Number(d.remaining || 0);
        guard++;
        setProgress(remaining > 0 ? Math.min(95, guard * 8) : 100);
        if (mode === "import_only") break;
      }
      await loadAssets();
      toast.success(`${label}: ${generated || ""} ${ru ? "готово" : "done"}`.trim());
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy("");
      setProgress(0);
    }
  };

  const metric = (label: string, value: number, total?: number, tone?: string) => (
    <div className="rounded-lg border border-border p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className={`text-xl font-semibold ${tone || ""}`}>
        {value}{typeof total === "number" ? <span className="text-sm text-muted-foreground"> / {total}</span> : null}
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between space-y-0">
          <CardTitle className="flex items-center gap-2 text-base">
            <Images className="h-4 w-4" /> {ru ? "Медиа-движок" : "Media Engine"}
          </CardTitle>
          <div className="flex items-center gap-2">
            <Select value={scope} onValueChange={setScope}>
              <SelectTrigger className="h-8 w-[170px]"><SelectValue /></SelectTrigger>
              <SelectContent>
                {SCOPES.map((s) => (
                  <SelectItem key={s} value={s}>
                    {ru
                      ? { all: "Все страницы", products: "Товары и услуги", categories: "Категории", articles: "Статьи" }[s]
                      : { all: "All pages", products: "Products", categories: "Categories", articles: "Articles" }[s]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="ghost" onClick={() => void refresh()} disabled={!!busy}>
              <RefreshCw className="h-4 w-4" />
            </Button>
          </div>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {metric(ru ? "Товары с фото" : "Products with photo", stats?.products_with_photo ?? 0, stats?.products_total ?? 0)}
            {metric(ru ? "Категории с баннером" : "Categories with banner", stats?.categories_with_photo ?? 0, stats?.categories_total ?? 0)}
            {metric(ru ? "Статьи с обложкой" : "Articles with cover", stats?.articles_with_cover ?? 0, stats?.articles_total ?? 0)}
            {metric(ru ? "Всего изображений" : "Images total", stats?.images_total ?? 0)}
          </div>
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {metric(ru ? "Сгенерировано AI" : "AI generated", stats?.ai ?? 0)}
            {metric(ru ? "Импортировано" : "Imported", stats?.imported ?? 0)}
            {metric(ru ? "Заглушки" : "Placeholders", stats?.placeholder ?? 0, undefined,
              (stats?.placeholder ?? 0) > 0 ? "text-destructive" : "")}
            {metric(ru ? "Без ALT" : "Without ALT", stats?.no_alt ?? 0, undefined,
              (stats?.no_alt ?? 0) > 0 ? "text-amber-500" : "")}
          </div>

          {busy ? <Progress value={progress} className="h-1.5" /> : null}

          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="outline" disabled={!!busy}
              onClick={() => void run("import_only", ru ? "Импорт" : "Import")}>
              {busy === "import_only" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Download className="mr-2 h-4 w-4" />}
              {ru ? "Импортировать реальные фото" : "Import real photos"}
            </Button>
            <Button size="sm" disabled={!!busy}
              onClick={() => void run("generate_missing", ru ? "Генерация" : "Generation")}>
              {busy === "generate_missing" ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : <Sparkles className="mr-2 h-4 w-4" />}
              {ru ? "Сгенерировать недостающие" : "Generate missing"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {ru
              ? "Реальные фото всегда имеют приоритет над AI. Генерация опирается только на характеристики из каталога - модель не придумывает факты."
              : "Real photos always win over AI. Generation relies only on catalog facts - the model invents nothing."}
          </p>
        </CardContent>
      </Card>

      {assets.length > 0 && (
        <Card>
          <CardHeader><CardTitle className="text-base">{ru ? "Последние изображения" : "Latest images"}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4 lg:grid-cols-6">
              {assets.map((a) => (
                <figure key={a.id} className="space-y-1">
                  <div className="aspect-square overflow-hidden rounded-md border border-border bg-muted">
                    {a.image_url
                      ? <img src={a.image_url} alt={a.alt || a.entity_type} loading="lazy" className="h-full w-full object-cover" />
                      : null}
                  </div>
                  <figcaption className="flex items-center gap-1 text-[11px] text-muted-foreground">
                    <Badge variant="outline" className="px-1 py-0 text-[10px]">{a.image_type}</Badge>
                    <span className="truncate">{a.source}</span>
                  </figcaption>
                </figure>
              ))}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
