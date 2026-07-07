import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wand2, Quote, Table2, Search, MapPin, MessageSquarePlus,
  Link2, FileText, ExternalLink, ChevronDown, ChevronUp, Globe, CheckCircle2, Loader2,
} from "lucide-react";
import { PersonaSelector } from "@/components/article/PersonaSelector";
import { ModelSelector } from "@/components/ModelSelector";
import { useI18n } from "@/shared/hooks/useI18n";
import { useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { SuggestTopicsDialog } from "./SuggestTopicsDialog";

interface ProjectArticleForLinks {
  id: string;
  title: string;
  published_url: string | null;
}

interface GenerationFormProps {
  // Lookup data
  projects: any[];
  projectArticlesForLinks: ProjectArticleForLinks[];
  keywords: any[];
  authorProfiles: any[];

  // Project / interlinking
  selectedProjectId: string;
  onProjectChange: (id: string) => void;
  showInterlinkingArticles: boolean;
  onToggleInterlinking: () => void;

  // Form state (controlled)
  selectedKeywordId: string;
  onKeywordChange: (id: string) => void;
  selectedAuthorId: string;
  onAuthorChange: (id: string) => void;
  includeExpertQuote: boolean;
  onExpertQuoteChange: (v: boolean) => void;
  includeComparisonTable: boolean;
  onComparisonTableChange: (v: boolean) => void;
  seoKeywords: string;
  onSeoKeywordsChange: (v: string) => void;
  enableGeo: boolean;
  onGeoChange: (v: boolean) => void;
  geoLocation: string;
  onGeoLocationChange: (v: string) => void;
  customInstructions: string;
  onCustomInstructionsChange: (v: string) => void;

  // Source page (user's own URL - facts injected into prompt)
  sourcePageUrl: string;
  onSourcePageUrlChange: (v: string) => void;
  sourcePageFacts: any | null;
  onSourcePageFactsChange: (f: any | null) => void;

  // Model selection (credit-based pricing)
  selectedModel?: string;
  onModelChange?: (modelKey: string) => void;
  userPlan?: string;

  // Generation actions
  isStreaming: boolean;
  onGenerate: () => void;
  onStop: () => void;
  onOpenSectioned: () => void;
  quickMode?: boolean;
}

/**
 * Presentational generation form (Step 2 refactor).
 * State lives in ArticlesPage; this component renders the configuration card
 * with project/keyword/author selectors, options chips, SEO/Geo inputs and
 * the Generate / Stop / Sectioned buttons.
 */
export function GenerationForm(props: GenerationFormProps) {
  const { t, lang } = useI18n();
  const {
    projects, projectArticlesForLinks, keywords, authorProfiles,
    selectedProjectId, onProjectChange,
    showInterlinkingArticles, onToggleInterlinking,
    selectedKeywordId, onKeywordChange,
    selectedAuthorId, onAuthorChange,
    includeExpertQuote, onExpertQuoteChange,
    includeComparisonTable, onComparisonTableChange,
    seoKeywords, onSeoKeywordsChange,
    enableGeo, onGeoChange,
    geoLocation, onGeoLocationChange,
    customInstructions, onCustomInstructionsChange,
    sourcePageUrl, onSourcePageUrlChange,
    sourcePageFacts, onSourcePageFactsChange,
    selectedModel, onModelChange, userPlan,
    isStreaming, onGenerate, onStop, onOpenSectioned,
    quickMode,
  } = props;

  const [loadingFacts, setLoadingFacts] = useState(false);

  const loadFacts = async () => {
    const url = sourcePageUrl.trim();
    if (!url) { toast.error(lang === "ru" ? "Укажите URL страницы" : "Enter page URL"); return; }
    if (!/^https?:\/\//i.test(url)) { toast.error(lang === "ru" ? "URL должен начинаться с http:// или https://" : "URL must start with http(s)://"); return; }
    setLoadingFacts(true);
    try {
      const { data, error } = await supabase.functions.invoke("extract-source-facts", { body: { url, force: true } });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(data.error);
      onSourcePageFactsChange(data?.facts || null);
      toast.success(lang === "ru" ? "Факты со страницы загружены" : "Page facts loaded");
    } catch (e: any) {
      toast.error(e?.message || (lang === "ru" ? "Не удалось загрузить факты" : "Failed to load facts"));
      onSourcePageFactsChange(null);
    } finally { setLoadingFacts(false); }
  };

  const isTelegraphAuthor = !!(selectedAuthorId && selectedAuthorId !== "none" &&
    authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф"));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      {/* AI Model selector with live credit cost */}
      {onModelChange && (
        <div className="mb-3 pb-3 border-b border-border">
          <ModelSelector
            value={selectedModel || ""}
            onChange={onModelChange}
            userPlan={userPlan}
            label={lang === "ru" ? "Модель ИИ и стоимость" : "AI model & cost"}
          />
        </div>
      )}

      {/* Project selector (FACTORY only) */}
      {projects.length > 0 && (
        <div className="mb-3 pb-3 border-b border-border">
          <Label className="text-xs text-muted-foreground">{t("projects.selectProject")}</Label>
          <Select value={selectedProjectId} onValueChange={onProjectChange}>
            <SelectTrigger className="mt-1.5">
              <SelectValue placeholder={t("projects.noProject")} />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="none">{t("projects.noProject")}</SelectItem>
              {projects.map((p: any) => (
                <SelectItem key={p.id} value={p.id}>
                  {p.name} ({p.domain || "-"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Interlinking articles panel */}
      {!quickMode && selectedProjectId && selectedProjectId !== "none" && projectArticlesForLinks.length > 0 && (
        <div className="mb-3 pb-3 border-b border-border">
          <button
            type="button"
            onClick={onToggleInterlinking}
            className="flex items-center gap-2 text-xs text-muted-foreground hover:text-foreground transition-colors w-full"
          >
            <Link2 className="h-3.5 w-3.5" />
            <span>{lang === "ru" ? "Статьи для перелинковки" : "Articles for interlinking"} ({projectArticlesForLinks.length})</span>
            {showInterlinkingArticles ? <ChevronUp className="h-3.5 w-3.5 ml-auto" /> : <ChevronDown className="h-3.5 w-3.5 ml-auto" />}
          </button>
          {showInterlinkingArticles && (
            <div className="mt-2 space-y-1.5 max-h-48 overflow-y-auto">
              {projectArticlesForLinks.map((article: any) => (
                <div key={article.id} className="flex items-center gap-2 text-xs p-1.5 rounded bg-muted/50">
                  <FileText className="h-3 w-3 shrink-0 text-muted-foreground" />
                  <span className="truncate flex-1 font-medium">{article.title}</span>
                  {article.published_url ? (
                    <a href={article.published_url} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline flex items-center gap-1 shrink-0">
                      <ExternalLink className="h-3 w-3" />
                      <span className="max-w-[200px] truncate">{article.published_url}</span>
                    </a>
                  ) : (
                    <span className="text-destructive/70 text-[10px] shrink-0">{lang === "ru" ? "URL не указан" : "No URL"}</span>
                  )}
                </div>
              ))}
              <p className="text-[10px] text-muted-foreground mt-1">
                {lang === "ru"
                  ? "Укажите Published URL у каждой статьи (в редакторе → SEO/Meta) для корректной перелинковки."
                  : "Set Published URL for each article (in editor → SEO/Meta) for proper interlinking."}
              </p>
            </div>
          )}
        </div>
      )}

      <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">{t("articles.keyword")}</Label>
          <Select value={selectedKeywordId} onValueChange={onKeywordChange}>
            <SelectTrigger>
              <SelectValue placeholder={t("common.select")} />
            </SelectTrigger>
            <SelectContent>
              {keywords.map((k: any) => (
                <SelectItem key={k.id} value={k.id}>
                  {k.seed_keyword} - {k.intent}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!quickMode && (
            <SuggestTopicsDialog
              keyword={(keywords.find((k: any) => k.id === selectedKeywordId)?.seed_keyword) || null}
              language={lang}
              geo={enableGeo ? geoLocation : undefined}
              disabled={isStreaming}
              onPick={(topic) => {
                const prefix = lang === "ru" ? "Угол подачи" : "Angle";
                const h1Label = lang === "ru" ? "Заголовок H1" : "H1";
                const block = `${prefix}: ${topic.angle}\n${h1Label}: ${topic.h1}\nIntent: ${topic.intent}`;
                const next = customInstructions?.trim()
                  ? `${customInstructions.trim()}\n\n${block}`
                  : block;
                onCustomInstructionsChange(next);
                toast.success(lang === "ru" ? "Тема добавлена в инструкции" : "Topic added to instructions");
              }}
            />
          )}
        </div>
        <div className="space-y-1.5">
          <Label className="text-xs text-muted-foreground">&nbsp;</Label>
          {isStreaming ? (
            <Button variant="destructive" onClick={onStop} className="w-full">
              {t("articles.stop")}
            </Button>
          ) : (
            <Button
              onClick={onGenerate}
              disabled={!selectedKeywordId}
              className="w-full gap-2"
            >
              <Wand2 className="h-4 w-4" />
              Generate
            </Button>
          )}
          {!isStreaming && (
            !quickMode &&
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedKeywordId}
              className="w-full mt-1.5 gap-2 text-xs"
              onClick={onOpenSectioned}
              title="Генерировать по разделам со стримингом и регенерацией каждого H2"
            >
              <Wand2 className="h-3.5 w-3.5" />
              По разделам
            </Button>
          )}
        </div>
      </div>

      {/* Persona Selector */}
      <div id="persona-selector-anchor">
        <PersonaSelector
          authors={authorProfiles}
          selectedId={selectedAuthorId}
          onSelect={onAuthorChange}
          quickMode={quickMode}
          keywordText={keywords.find((k: any) => k.id === selectedKeywordId)?.seed_keyword || ""}
        />
      </div>

      {/* Content formatting options */}
      {!quickMode && (
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border mt-3">
        <button
          type="button"
          onClick={() => onExpertQuoteChange(!includeExpertQuote)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 select-none cursor-pointer ${
            includeExpertQuote
              ? 'border-purple-500/60 text-white bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.4)]'
              : 'border-slate-800 text-slate-400 bg-white/5 hover:bg-white/10 hover:border-slate-700'
          }`}
        >
          <Quote className={`h-3.5 w-3.5 ${includeExpertQuote ? 'text-purple-400' : 'text-slate-500'}`} />
          {t("articles.expertQuote")}
        </button>
        <button
          type="button"
          disabled={isTelegraphAuthor}
          title={isTelegraphAuthor ? "Telegra.ph не поддерживает таблицы" : undefined}
          onClick={() => !isTelegraphAuthor && onComparisonTableChange(!includeComparisonTable)}
          className={`flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border transition-all duration-200 select-none ${
            isTelegraphAuthor
              ? 'border-slate-800 text-slate-600 bg-white/5 opacity-50 cursor-not-allowed'
              : includeComparisonTable
                ? 'border-purple-500/60 text-white bg-purple-500/10 shadow-[0_0_15px_rgba(168,85,247,0.4)] cursor-pointer'
                : 'border-slate-800 text-slate-400 bg-white/5 hover:bg-white/10 hover:border-slate-700 cursor-pointer'
          }`}
        >
          <Table2 className={`h-3.5 w-3.5 ${includeComparisonTable && !isTelegraphAuthor ? 'text-purple-400' : 'text-slate-500'}`} />
          {t("articles.comparisonTable")}
        </button>
      </div>
      )}

      {/* SEO Keywords, Geo, Custom Instructions */}
      {!quickMode && (
      <div className="space-y-3 pt-3 border-t border-border">
        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Search className="h-3 w-3" />
            {t("articles.seoKeywords")}
          </Label>
          <Input
            value={seoKeywords}
            onChange={(e) => onSeoKeywordsChange(e.target.value)}
            placeholder={t("articles.seoKeywordsPlaceholder")}
            className="h-8 text-sm bg-muted/30"
          />
        </div>

        <div className="flex items-center gap-2">
          <Checkbox
            id="geo-toggle"
            checked={enableGeo}
            onCheckedChange={(v) => onGeoChange(!!v)}
            className="data-[state=checked]:bg-primary data-[state=checked]:border-primary"
          />
          <label htmlFor="geo-toggle" className="text-sm text-foreground cursor-pointer flex items-center gap-1.5">
            <MapPin className="h-3.5 w-3.5 text-muted-foreground" />
            {t("articles.addGeo")}
          </label>
        </div>

        {enableGeo && (
          <div className="space-y-1 animate-in fade-in slide-in-from-top-1 duration-200">
            <Label className="text-[11px] text-muted-foreground">{t("articles.targetRegion")}</Label>
            <Input
              value={geoLocation}
              onChange={(e) => onGeoLocationChange(e.target.value)}
              placeholder={t("articles.targetRegionPlaceholder")}
              className="h-8 text-sm bg-muted/30"
            />
          </div>
        )}

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <MessageSquarePlus className="h-3 w-3" />
            {t("articles.customInstructions")}
          </Label>
          <Textarea
            value={customInstructions}
            onChange={(e) => onCustomInstructionsChange(e.target.value)}
            placeholder={t("articles.customInstructionsPlaceholder")}
            className="min-h-[72px] text-sm bg-muted/30 resize-y"
            rows={3}
          />
        </div>

        <div className="space-y-1">
          <Label className="text-[11px] text-muted-foreground flex items-center gap-1.5">
            <Globe className="h-3 w-3" />
            {lang === "ru" ? "URL вашей страницы (статья будет использовать факты с неё)" : "Your page URL (article will use facts from it)"}
          </Label>
          <div className="flex gap-2">
            <Input
              value={sourcePageUrl}
              onChange={(e) => { onSourcePageUrlChange(e.target.value); if (sourcePageFacts) onSourcePageFactsChange(null); }}
              placeholder="https://yoursite.com/page"
              className="h-8 text-sm bg-muted/30 flex-1"
            />
            <Button type="button" size="sm" variant="outline" disabled={loadingFacts || !sourcePageUrl.trim()} onClick={loadFacts} className="h-8 gap-1.5 shrink-0">
              {loadingFacts ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : sourcePageFacts ? <CheckCircle2 className="h-3.5 w-3.5 text-emerald-400" /> : <Globe className="h-3.5 w-3.5" />}
              {sourcePageFacts ? (lang === "ru" ? "Обновить" : "Refresh") : (lang === "ru" ? "Загрузить факты" : "Load facts")}
            </Button>
          </div>
          {sourcePageFacts && (
            <div className="mt-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/5 p-2 text-[11px] space-y-0.5 text-foreground/80">
              {sourcePageFacts.service_name && <div><span className="text-muted-foreground">Услуга:</span> {sourcePageFacts.service_name}</div>}
              {sourcePageFacts.usp && <div><span className="text-muted-foreground">УТП:</span> {sourcePageFacts.usp}</div>}
              {Array.isArray(sourcePageFacts.key_numbers) && sourcePageFacts.key_numbers.length > 0 && (
                <div><span className="text-muted-foreground">Цифры:</span> {sourcePageFacts.key_numbers.join("; ")}</div>
              )}
              {sourcePageFacts.location && <div><span className="text-muted-foreground">Гео:</span> {sourcePageFacts.location}</div>}
              {Array.isArray(sourcePageFacts.features) && sourcePageFacts.features.length > 0 && (
                <div><span className="text-muted-foreground">Особенности:</span> {sourcePageFacts.features.slice(0, 6).join("; ")}</div>
              )}
              {Array.isArray(sourcePageFacts.brands) && sourcePageFacts.brands.length > 0 && (
                <div><span className="text-muted-foreground">Бренды:</span> {sourcePageFacts.brands.join("; ")}</div>
              )}
              {sourcePageFacts.pricing && <div><span className="text-muted-foreground">Цены:</span> {sourcePageFacts.pricing}</div>}
              {sourcePageFacts.guarantees && <div><span className="text-muted-foreground">Гарантии:</span> {sourcePageFacts.guarantees}</div>}
              {sourcePageFacts.delivery && <div><span className="text-muted-foreground">Доставка:</span> {sourcePageFacts.delivery}</div>}
              {Array.isArray(sourcePageFacts.must_mention) && sourcePageFacts.must_mention.length > 0 && (
                <div className="pt-1 border-t border-emerald-500/20"><span className="text-muted-foreground">Якоря:</span> {sourcePageFacts.must_mention.slice(0, 8).join("; ")}</div>
              )}
            </div>
          )}
          <p className="text-[10px] text-muted-foreground mt-1">
            {lang === "ru"
              ? "AI извлечёт ключевые факты (УТП, цифры, услуги) и будет писать статью именно под них, а не под общие данные конкурентов."
              : "AI extracts key facts (USP, numbers, services) and writes around them instead of generic competitor data."}
          </p>
        </div>
      </div>
      )}
    </div>
  );
}