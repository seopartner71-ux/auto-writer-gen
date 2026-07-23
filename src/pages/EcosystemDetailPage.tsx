import { useNavigate, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, FileText, Newspaper, FileCode, FileSpreadsheet, Presentation, CheckSquare, Globe, Package, Loader2 } from "lucide-react";
import { EcosystemFormat, FORMAT_LABELS, FormatType } from "@/features/content-ecosystem/types";

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

  const { data, isLoading } = useQuery({
    queryKey: ["ecosystem", ecosystemId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("content_ecosystems")
        .select("*, articles(id,title), clients(id,name,logo_url,brand_color), ecosystem_formats(*)")
        .eq("id", ecosystemId!)
        .single();
      if (error) throw error;
      return data;
    },
    enabled: !!ecosystemId,
  });

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
          return (
            <Card key={f.id} className="p-4 space-y-3">
              <div className="flex items-center gap-2">
                <Icon className="h-5 w-5 text-primary" />
                <span className="font-medium">{label}</span>
              </div>
              <Badge variant="outline" className="text-xs">
                {f.status === "pending" ? "В разработке" : f.status}
              </Badge>
              {f.model_used && <p className="text-xs text-muted-foreground">Модель: {f.model_used}</p>}
              <Button size="sm" variant="outline" className="w-full" disabled={f.status !== "completed"}>
                Открыть
              </Button>
            </Card>
          );
        })}
      </div>

      <p className="text-xs text-muted-foreground text-center pt-4">
        Генерация форматов появится в ближайших обновлениях. Сейчас доступна структура экосистемы.
      </p>
    </div>
  );
}