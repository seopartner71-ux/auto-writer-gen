import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  Wand2, Quote, Table2, Search, MapPin, MessageSquarePlus,
  Link2, FileText, ExternalLink, ChevronDown, ChevronUp,
} from "lucide-react";
import { PersonaSelector } from "@/components/article/PersonaSelector";
import { useI18n } from "@/shared/hooks/useI18n";

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

  // Generation actions
  isStreaming: boolean;
  onGenerate: () => void;
  onStop: () => void;
  onOpenSectioned: () => void;
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
    isStreaming, onGenerate, onStop, onOpenSectioned,
  } = props;

  const isTelegraphAuthor = !!(selectedAuthorId && selectedAuthorId !== "none" &&
    authorProfiles.find((a: any) => a.id === selectedAuthorId && a.name === "Телеграф"));

  return (
    <div className="rounded-lg border border-border bg-card p-4">
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
                  {p.name} ({p.domain || "—"})
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}

      {/* Interlinking articles panel */}
      {selectedProjectId && selectedProjectId !== "none" && projectArticlesForLinks.length > 0 && (
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
                  {k.seed_keyword} — {k.intent}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
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
            <Button
              variant="outline"
              size="sm"
              disabled={!selectedKeywordId}
              className="w-full mt-1.5 gap-2 text-xs"
              onClick={onOpenSectioned}
              title="Генерировать по разделам со стримингом и регенерацией каждого H2"
            >
              <Wand2 className="h-3.5 w-3.5" />
              По разделам (beta)
            </Button>
          )}
        </div>
      </div>

      {/* Persona Selector */}
      <PersonaSelector
        authors={authorProfiles}
        selectedId={selectedAuthorId}
        onSelect={onAuthorChange}
      />

      {/* Content formatting options */}
      <div className="flex flex-wrap items-center gap-3 pt-2 border-t border-border mt-3">
        {(() => {
          // Telegra.ph не поддерживает HTML-таблицы и микроразметку — принудительно
          // выключаем чип "Таблица сравнения" при выборе автора Телеграф.
          if (isTelegraphAuthor && includeComparisonTable) {
            setTimeout(() => onComparisonTableChange(false), 0);
          }
          return null;
        })()}
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

      {/* SEO Keywords, Geo, Custom Instructions */}
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
      </div>
    </div>
  );
}