import { useState } from "react";
import { invokeErrorMessage } from "@/shared/utils/invokeError";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { toast } from "sonner";
import { Loader2, ShieldCheck, FileDown, AlertTriangle, Sparkles } from "lucide-react";
import JSZip from "jszip";
import { saveAs } from "file-saver";

interface Issue { level: string; kind: string; page: string; detail?: string }
interface Report {
  pages: number; errors: number; critical: number; warnings: number;
  score: number; ok: boolean; pass: boolean; issues: Issue[];
}

const KIND_RU: Record<string, string> = {
  missing_title: "Нет title",
  long_title: "Длинный title",
  missing_description: "Нет description",
  long_description: "Длинный description",
  missing_h1: "Нет H1",
  multiple_h1: "Несколько H1",
  duplicate_h1: "Дубликат H1",
  missing_canonical: "Нет canonical",
  canonical_mismatch: "Canonical не совпадает с URL",
  duplicate_canonical: "Дубликат canonical",
  foreign_canonical: "Чужой canonical",
  robots_conflict: "Конфликт meta robots",
  img_without_alt: "Картинки без alt",
  broken_internal_link: "Битая внутренняя ссылка",
  duplicate_title: "Дубликат title",
  missing_sitemap: "Нет sitemap.xml",
  invalid_sitemap: "Некорректный sitemap.xml",
  sitemap_missing_file: "URL в sitemap без страницы",
  url_not_in_sitemap: "Страницы нет в sitemap",
  noindex_in_sitemap: "Noindex-страница в sitemap",
  missing_robots: "Нет robots.txt",
  invalid_schema: "Ошибка в JSON-LD",
  missing_breadcrumb_schema: "Нет BreadcrumbList",
  orphan_page: "Страница без входящих ссылок",
  page_without_outgoing_links: "Страница без исходящих ссылок",
  orphan_product: "Товар без категории",
  cluster_without_silo: "Категория без силоса",
  empty_cluster: "Пустая категория",
  empty_silo: "Пустой силос",
  commercial_page_without_content: "Страница без SEO-контента",
  page_without_primary_keyword: "Нет главного ключа у страницы",
  thin_commercial_content: "Тонкий контент",
  low_semantic_coverage: "Мало семантики в контенте",
  missing_entity_data: "Нет сущностей (entities)",
  missing_faq: "Нет FAQ-блока",
  duplicate_generated_content: "Дубликат сгенерированного текста",
  keyword_without_target: "Ключ без страницы",
  category_without_keywords: "Категория без семантики",
};

export function QaPanel({ projectId, ru, siteName }: { projectId: string; ru: boolean; siteName: string }) {
  const [busy, setBusy] = useState<"qa" | "zip" | "content" | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [fullStatic, setFullStatic] = useState(true);

  const run = async (withFiles: boolean) => {
    setBusy(withFiles ? "zip" : "qa");
    try {
      const { data, error } = await supabase.functions.invoke("site-qa-check", {
        body: {
          project_id: projectId,
          include_files: withFiles,
          ...(withFiles && fullStatic ? { mode: "full_static" } : {}),
        },
      });
      if (error) throw error;
      const payload = data as {
        report?: Report; files?: Record<string, string>; assets?: Record<string, string>;
        asset_stats?: { localized: number; requested: number };
      };
      const rep = payload?.report as Report;
      setReport(rep);
      if (withFiles) {
        const files = payload?.files;
        if (!files) throw new Error(ru ? "Сборка не вернула файлы" : "Build returned no files");
        const zip = new JSZip();
        for (const [path, content] of Object.entries(files)) zip.file(path, content);
        for (const [path, b64] of Object.entries(payload?.assets || {})) zip.file(path, b64, { base64: true });
        const blob = await zip.generateAsync({ type: "blob" });
        saveAs(blob, `${(siteName || "site").replace(/[^\w-]+/g, "-").toLowerCase()}.zip`);
        const st = payload?.asset_stats;
        toast.success(ru
          ? `ZIP сформирован${st ? `, изображений локально: ${st.localized}/${st.requested}` : ""}`
          : `ZIP ready${st ? `, images localized: ${st.localized}/${st.requested}` : ""}`);
      } else {
        toast.success(ru ? `QA готов: ${rep?.score}/100` : `QA done: ${rep?.score}/100`);
      }
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "QA failed"));
    } finally {
      setBusy(null);
    }
  };

  const generateContent = async () => {
    setBusy("content");
    try {
      const { data, error } = await supabase.functions.invoke("generate-commerce-content", {
        body: { project_id: projectId, scope: "all", limit: 40 },
      });
      if (error) throw error;
      const r = data as { generated?: number; fallbacks?: number; pending?: number; coverage?: { covered: number; total: number } };
      toast.success(ru
        ? `Контент создан: ${r?.generated ?? 0}, семантика: ${r?.coverage?.covered ?? 0}/${r?.coverage?.total ?? 0}${r?.pending ? `, осталось: ${r.pending}` : ""}`
        : `Content generated: ${r?.generated ?? 0}, semantics: ${r?.coverage?.covered ?? 0}/${r?.coverage?.total ?? 0}${r?.pending ? `, pending: ${r.pending}` : ""}`);
      if (r?.pending) {
        toast.info(ru ? "Запустите генерацию еще раз, чтобы закрыть остаток" : "Run generation again to finish the queue");
      }
    } catch (e) {
      toast.error(await invokeErrorMessage(e, "Generation failed"));
    } finally {
      setBusy(null);
    }
  };

  const critical = report ? (report.critical ?? report.errors ?? 0) : 0;
  const color = !report ? "" : report.score >= 70 ? "text-green-500" : report.score >= 30 ? "text-yellow-500" : "text-destructive";

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" variant="outline" onClick={() => run(false)} disabled={!!busy}>
          {busy === "qa" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <ShieldCheck className="h-4 w-4 mr-2" />}
          {ru ? "Проверить сайт" : "Run QA"}
        </Button>
        <Button size="sm" onClick={generateContent} disabled={!!busy}>
          {busy === "content" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Sparkles className="h-4 w-4 mr-2" />}
          {ru ? "Сгенерировать SEO-контент" : "Generate SEO content"}
        </Button>
        <Button size="sm" variant="outline" onClick={() => run(true)} disabled={!!busy}>
          {busy === "zip" ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <FileDown className="h-4 w-4 mr-2" />}
          {ru ? "Экспорт в ZIP" : "Export ZIP"}
        </Button>
        <div className="flex items-center gap-2">
          <Switch id="full-static" checked={fullStatic} onCheckedChange={setFullStatic} />
          <Label htmlFor="full-static" className="text-xs text-muted-foreground">
            {ru ? "Полный статик (фото внутри архива)" : "Full static (images inside archive)"}
          </Label>
        </div>
      </div>

      {report && critical > 0 && (
        <div className="flex items-start gap-2 rounded border border-destructive/40 bg-destructive/5 p-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
          <span>
            {ru
              ? `Публикация заблокирована: критических ошибок ${critical}. Исправьте их или отключите QA-гейт во вкладке «Обзор».`
              : `Publishing is blocked: ${critical} critical issues. Fix them or turn the QA gate off in the Overview tab.`}
          </span>
        </div>
      )}

      {report && (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2 text-xs">
            <Badge variant="outline" className={color}>Score: {report.score}/100</Badge>
            <Badge variant="outline">{ru ? "Страниц" : "Pages"}: {report.pages}</Badge>
            <Badge variant="outline" className={critical ? "text-destructive" : "text-green-500"}>
              {ru ? "Критичные" : "Critical"}: {critical}
            </Badge>
            <Badge variant="outline" className="text-yellow-500">{ru ? "Замечания" : "Warnings"}: {report.warnings}</Badge>
          </div>
          <div className="max-h-64 overflow-auto rounded border border-border/60 text-xs">
            {report.issues.map((i, idx) => (
              <div key={idx} className="flex gap-2 p-2 border-b border-border/40 last:border-0">
                <span className={i.level === "critical" || i.level === "error" ? "text-destructive" : "text-yellow-500"}>
                  {ru ? (KIND_RU[i.kind] || i.kind) : i.kind}
                </span>
                <span className="text-muted-foreground truncate">{i.page}</span>
                {i.detail && <span className="text-muted-foreground/70 truncate">{i.detail}</span>}
              </div>
            ))}
            {!report.issues.length && (
              <div className="p-3 text-green-500">{ru ? "Проблем не найдено" : "No issues found"}</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
