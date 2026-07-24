import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import { ArrowLeft, FileText, Newspaper, FileSpreadsheet, Presentation, CheckSquare, Globe, Package, Loader2, Sparkles, RotateCcw, Eye, AlertTriangle, Github } from "lucide-react";
import { EcosystemFormat, FORMAT_LABELS, FormatType } from "@/features/content-ecosystem/types";
import { ChecklistPreviewModal } from "@/features/content-ecosystem/ChecklistPreviewModal";
import { DzenPreviewModal } from "@/features/content-ecosystem/DzenPreviewModal";

const FORMAT_ICONS: Record<FormatType, any> = {
  vc_ru: Newspaper,
  dzen: Newspaper,
  scribd_pdf: FileText,
  google_docs: FileSpreadsheet,
  presentation: Presentation,
  checklist: CheckSquare,
  issuu: Globe,
  google_sites: Globe,
  branded_pdf: Package,
};

export default function EcosystemDetailPage() {
  const { ecosystemId } = useParams<{ ecosystemId: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [previewFormat, setPreviewFormat] = useState<EcosystemFormat | null>(null);
  const [dzenFormat, setDzenFormat] = useState<EcosystemFormat | null>(null);
  const [starting, setStarting] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ["ecosystem", ecosystemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_ecosystems")
        .select("*, articles(id,title), clients(id,name,logo_url,brand_color,github_username,github_token_encrypted), ecosystem_formats(*, format_deployments(id,status,published_url,platform))")
        .eq("id", ecosystemId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!ecosystemId,
  });

  // Realtime subscription: refresh formats when rows change.
  useEffect(() => {
    if (!ecosystemId) return;
    const channel = supabase
      .channel(`ecosystem-formats-${ecosystemId}`)
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "ecosystem_formats", filter: `ecosystem_id=eq.${ecosystemId}` },
        () => queryClient.invalidateQueries({ queryKey: ["ecosystem", ecosystemId] }),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [ecosystemId, queryClient]);

  // Keep preview in sync with fresh row data.
  useEffect(() => {
    if (!previewFormat || !data) return;
    const fresh = ((data as any).ecosystem_formats as EcosystemFormat[] | undefined)?.find(
      (f) => f.id === previewFormat.id,
    );
    if (fresh && fresh !== previewFormat) setPreviewFormat(fresh);
  }, [data, previewFormat]);

  const startChecklist = async (formatId: string) => {
    if (!ecosystemId) return;
    setStarting((s) => ({ ...s, [formatId]: true }));
    try {
      const { error } = await supabase.functions.invoke("generate-checklist", {
        body: { ecosystem_id: ecosystemId, format_id: formatId },
      });
      if (error) throw error;
      toast.success("Запустили генерацию чек-листа");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось запустить генерацию");
    } finally {
      setStarting((s) => ({ ...s, [formatId]: false }));
    }
  };

  const startDzen = async (formatId: string) => {
    if (!ecosystemId) return;
    setStarting((s) => ({ ...s, [formatId]: true }));
    try {
      const { error } = await supabase.functions.invoke("generate-dzen", {
        body: { ecosystem_id: ecosystemId, format_id: formatId },
      });
      if (error) throw error;
      toast.success("Запустили генерацию статьи для Дзена");
    } catch (e: any) {
      toast.error(e?.message || "Не удалось запустить генерацию");
    } finally {
      setStarting((s) => ({ ...s, [formatId]: false }));
    }
  };

  if (isLoading) {
    return <div className="p-10 flex justify-center"><Loader2 className="h-6 w-6 animate-spin text-primary" /></div>;
  }
  if (!data) {
    return <div className="p-10 text-center text-muted-foreground">Экосистема не найдена</div>;
  }

  const formats: EcosystemFormat[] = (data.ecosystem_formats as EcosystemFormat[]) || [];
  const requested = (data.formats_requested as string[]) || [];
  const completed = (data.formats_completed as string[]) || [];

  return (
    <div className="p-6 max-w-6xl mx-auto space-y-6">
      <Button variant="ghost" size="sm" onClick={() => navigate("/content-ecosystem")}>
        <ArrowLeft className="h-4 w-4 mr-2" /> К списку экосистем
      </Button>

      <header className="space-y-3">
        <h1 className="text-2xl font-bold">{data.articles?.title || "Экосистема"}</h1>
        <div className="flex items-center gap-3 flex-wrap">
          {data.clients?.logo_url ? (
            <img src={data.clients.logo_url} className="h-6 w-6 rounded" alt="" />
          ) : (
            <div className="h-6 w-6 rounded" style={{ background: data.clients?.brand_color || "#7C3AED" }} />
          )}
          <span className="text-sm">{data.clients?.name}</span>
          <Badge variant={data.status === "completed" ? "default" : "outline"}>{data.status}</Badge>
          <span className="text-sm text-muted-foreground">
            Прогресс: {completed.length}/{requested.length}
          </span>
        </div>
      </header>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {formats.map(f => {
          const Icon = FORMAT_ICONS[f.format_type as FormatType] || FileText;
          const label = FORMAT_LABELS[f.format_type as FormatType]?.ru || f.format_type;
          const isChecklist = f.format_type === "checklist";
          const isDzen = f.format_type === "dzen";
          const busy = f.status === "generating";
          const done = f.status === "completed";
          const partial = f.status === "partial";
          const failed = f.status === "failed";
          const statusLabel =
            busy ? "Генерируется"
            : done ? "Готово"
            : partial ? "Готово"
            : failed ? "Ошибка"
            : f.status === "pending" ? "Не запущено"
            : f.status;
          const statusVariant: any = done ? "default" : failed ? "destructive" : partial ? "secondary" : "outline";
          return (
            <Card key={f.id} className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-primary" />
                <span className="font-medium">{label}</span>
              </div>
              <div className="flex items-center gap-2 flex-wrap">
                <Badge variant={statusVariant} className="text-xs">{statusLabel}</Badge>
                {partial && (
                  <Badge variant="outline" className="text-xs border-amber-500 text-amber-600 dark:text-amber-400">
                    <AlertTriangle className="h-3 w-3 mr-1" /> Только текст, PDF не готов
                  </Badge>
                )}
                {(() => {
                  const deps: any[] = ((f as any).format_deployments) || [];
                  const gh = deps.find((d) => d.platform === "github_pages");
                  if (!gh) return null;
                  const color =
                    gh.status === "deployed" ? "text-green-600 dark:text-green-400"
                    : gh.status === "failed" ? "text-destructive"
                    : "text-amber-600 dark:text-amber-400";
                  const title =
                    gh.status === "deployed" ? `Опубликовано: ${gh.published_url || ""}`
                    : gh.status === "failed" ? "Ошибка публикации"
                    : "Публикация в процессе";
                  return (
                    <span title={title} className={`inline-flex items-center ${color}`}>
                      <Github className="h-3.5 w-3.5" />
                    </span>
                  );
                })()}
              </div>

              {busy && (
                <div className="space-y-1">
                  <Progress value={f.progress ?? 10} />
                  <p className="text-[11px] text-muted-foreground">{f.progress ?? 10}%</p>
                </div>
              )}
              {f.model_used && <p className="text-xs text-muted-foreground truncate">Модель: {f.model_used}</p>}
              {(failed || partial) && f.error_reason && (
                <p className="text-xs text-destructive line-clamp-2">{f.error_reason}</p>
              )}

              {isChecklist ? (
                <div className="flex flex-col gap-2">
                  {(done || partial) && (
                    <Button
                      size="sm"
                      variant={partial ? "outline" : "default"}
                      className={
                        "w-full " +
                        (partial ? "border-amber-500 text-amber-600 hover:bg-amber-500/10 dark:text-amber-400" : "")
                      }
                      onClick={() => setPreviewFormat(f)}
                    >
                      <Eye className="h-4 w-4 mr-2" /> Открыть
                    </Button>
                  )}
                  {!done && !partial && !busy && (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => startChecklist(f.id)}
                      disabled={!!starting[f.id]}
                    >
                      {starting[f.id] ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : failed ? (
                        <RotateCcw className="h-4 w-4 mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      {failed ? "Повторить" : "Сгенерировать"}
                    </Button>
                  )}
                  {busy && (
                    <Button size="sm" variant="outline" className="w-full" disabled>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Генерируется
                    </Button>
                  )}
                </div>
              ) : isDzen ? (
                <div className="flex flex-col gap-2">
                  {done && (
                    <Button size="sm" className="w-full" onClick={() => setDzenFormat(f)}>
                      <Eye className="h-4 w-4 mr-2" /> Открыть
                    </Button>
                  )}
                  {!done && !busy && (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => startDzen(f.id)}
                      disabled={!!starting[f.id]}
                    >
                      {starting[f.id] ? (
                        <Loader2 className="h-4 w-4 mr-2 animate-spin" />
                      ) : failed ? (
                        <RotateCcw className="h-4 w-4 mr-2" />
                      ) : (
                        <Sparkles className="h-4 w-4 mr-2" />
                      )}
                      {failed ? "Повторить" : "Сгенерировать"}
                    </Button>
                  )}
                  {busy && (
                    <Button size="sm" variant="outline" className="w-full" disabled>
                      <Loader2 className="h-4 w-4 mr-2 animate-spin" /> Генерируется
                    </Button>
                  )}
                </div>
              ) : (
                <Button size="sm" variant="outline" className="w-full" disabled>
                  Скоро
                </Button>
              )}
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center pt-4">
        Сейчас доступны чек-лист и статья для Яндекс.Дзен. Остальные форматы появятся в ближайших обновлениях.
      </p>

      <ChecklistPreviewModal
        open={!!previewFormat}
        onOpenChange={(o) => !o && setPreviewFormat(null)}
        format={previewFormat}
        client={(data as any)?.clients || null}
      />

      <DzenPreviewModal
        open={!!dzenFormat}
        onOpenChange={(o) => !o && setDzenFormat(null)}
        format={dzenFormat}
        articleKeyword={(data as any)?.articles?.title || null}
      />
    </div>
  );
}