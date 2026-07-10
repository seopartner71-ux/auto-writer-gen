import { useState, useMemo, useEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { OnboardingHint } from "@/components/onboarding/OnboardingHint";
import { useMutation } from "@tanstack/react-query";
import { useI18n } from "@/shared/hooks/useI18n";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeKeyword, validateKeywordInput } from "@/shared/utils/sanitizeKeyword";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, Globe, MapPin } from "lucide-react";
import { toast } from "sonner";
import { ResearchResults } from "@/components/research/ResearchResults";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { GEO_OPTIONS, LANG_OPTIONS, cityLabel, cityValue } from "@/features/geo/constants";

export interface Competitor {
  position: number;
  url: string;
  title: string;
  snippet: string;
  excluded?: boolean;
}

export interface ContentGap {
  topic: string;
  reason: string;
}

export interface ResearchAnalysis {
  intent: string;
  must_cover_topics: string[];
  content_gaps: ContentGap[];
  top_questions: string[];
  lsi_keywords: string[];
  difficulty_estimate: string;
  recommended_word_count: number;
  recommended_headings: string[];
}

export interface ResearchData {
  keyword_id: string;
  keyword: string;
  competitors: Competitor[];
  people_also_ask: string[];
  analysis: ResearchAnalysis;
  model_used: string;
}

export default function KeywordsPage() {
  const { t, lang } = useI18n();
  const [searchParams, setSearchParams] = useSearchParams();
  const [keyword, setKeyword] = useState("");
  const [geo, setGeo] = useState("ru");
  const [geoMode, setGeoMode] = useState<"country" | "city">("country");
  const [city, setCity] = useState("");
  const [language, setLanguage] = useState("ru");
  const [results, setResults] = useState<ResearchData | null>(null);
  const [batchProgress, setBatchProgress] = useState<{ current: number; total: number; currentKw: string } | null>(null);

  const parsedKeywords = useMemo(() => {
    return keyword
      .split(/\r?\n/)
      .map((k) => k.trim())
      .filter((k) => k.length >= 2)
      .slice(0, 10);
  }, [keyword]);
  const isBatch = parsedKeywords.length > 1;

  const currentCities = useMemo(() => {
    return GEO_OPTIONS.find((o) => o.value === geo)?.cities || [];
  }, [geo]);

  const autoRanRef = useRef(false);

  const research = useMutation({
    mutationFn: async () => {
      const list = parsedKeywords.length ? parsedKeywords : [keyword.trim()];
      let lastResult: ResearchData | null = null;
      let ok = 0;
      let failed = 0;
      for (let i = 0; i < list.length; i++) {
        const raw = list[i];
        const clean = sanitizeKeyword(raw);
        const vErr = validateKeywordInput(clean);
        if (vErr) { failed++; toast.error(`"${raw}": ${vErr === "too_short" ? t("keywords.tooShort") : t("keywords.tooLong")}`); continue; }
        setBatchProgress({ current: i + 1, total: list.length, currentKw: clean });
        try {
          const { data, error } = await supabase.functions.invoke("smart-research", {
            body: { keyword: clean, geo, language, ...(geoMode === "city" && city ? { city } : {}) },
          });
          if (error) throw error;
          if (data?.error) throw new Error(data.error);
          lastResult = data as ResearchData;
          ok++;
        } catch (e: any) {
          failed++;
          toast.error(`"${clean}": ${e?.message || t("keywords.genericError")}`);
        }
      }
      setBatchProgress(null);
      if (!lastResult) throw new Error(t("keywords.allFailed"));
      (lastResult as any).__batchStats = { ok, failed, total: list.length };
      return lastResult;
    },
    onSuccess: (data) => {
      setResults(data);
      const stats = (data as any).__batchStats;
      if (stats && stats.total > 1) {
        const errPart = stats.failed ? t("keywords.batchDoneErrors", { failed: stats.failed }) : "";
        toast.success(`${t("keywords.batchDone", { ok: stats.ok, total: stats.total })}${errPart}`);
      } else {
        toast.success(`${t("keywords.analysisComplete")} (${data.model_used})`);
      }
    },
    onError: (e) => { setBatchProgress(null); toast.error(e.message); },
  });

  useEffect(() => {
    const seed = searchParams.get("seed");
    if (seed && !autoRanRef.current) {
      autoRanRef.current = true;
      setKeyword(seed);
      // Clear param so refresh doesn't retrigger
      const next = new URLSearchParams(searchParams);
      next.delete("seed");
      setSearchParams(next, { replace: true });
      setTimeout(() => {
        research.mutate();
      }, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Search className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("keywords.title")}</h1>
          <p className="text-sm text-muted-foreground">
            {t("keywords.subtitle")}
          </p>
        </div>
      </div>

      {!keyword.trim() && !results && (
        <OnboardingHint message={t("onboarding.hintKeyword")} />
      )}

      {/* Search Form */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5 max-w-xl">
            <Label className="text-xs text-muted-foreground flex items-center justify-between">
              <span>{t("keywords.keyword")}</span>
              <span className="text-[10px] text-muted-foreground/70">
                {isBatch ? t("keywords.batchCount", { n: parsedKeywords.length }) : t("keywords.batchHint")}
              </span>
            </Label>
            <Textarea
              placeholder={`${t("keywords.keywordPlaceholder")}\n${t("keywords.placeholderMultiline")}`}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && (e.metaKey || e.ctrlKey) && parsedKeywords.length > 0) {
                  e.preventDefault();
                  research.mutate();
                }
              }}
              rows={isBatch ? Math.min(parsedKeywords.length + 1, 11) : 2}
              className="resize-y min-h-[44px]"
            />
          </div>
          {/* Settings row: geo + language, always visible, aligned with the CTA */}
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <Tabs value={geoMode} onValueChange={(v) => { setGeoMode(v as "country" | "city"); setCity(""); }} className="w-auto">
                <TabsList className="h-10 p-0.5">
                  <TabsTrigger value="country" className="text-xs px-3 h-9 gap-1">
                    <Globe className="h-3.5 w-3.5" /> {t("geo.country")}
                  </TabsTrigger>
                  <TabsTrigger value="city" className="text-xs px-3 h-9 gap-1">
                    <MapPin className="h-3.5 w-3.5" /> {t("geo.city")}
                  </TabsTrigger>
                </TabsList>
              </Tabs>
              <Select value={geo} onValueChange={(v) => { setGeo(v); setCity(""); }}>
                <SelectTrigger className="w-[170px] h-10 font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {GEO_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                      <span className="font-mono text-[10px] text-muted-foreground mr-2 uppercase">{o.value}</span>
                      {t(o.labelKey)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {geoMode === "city" && (
                <Select value={city} onValueChange={setCity}>
                  <SelectTrigger className="w-[190px] h-10">
                    <SelectValue placeholder={t("geo.selectCity")} />
                  </SelectTrigger>
                  <SelectContent>
                    {currentCities.map((c) => (
                      <SelectItem key={cityValue(c)} value={cityValue(c)}>{cityLabel(c, lang as "ru" | "en")}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
              <Select value={language} onValueChange={setLanguage}>
                <SelectTrigger className="w-[150px] h-10 font-medium">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {LANG_OPTIONS.map((o) => (
                    <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <Button
              disabled={parsedKeywords.length === 0 || research.isPending}
              onClick={() => research.mutate()}
              className="h-10 md:min-w-[180px]"
            >
              {research.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Search className="h-4 w-4 mr-2" />
              )}
              {research.isPending
                ? (batchProgress && batchProgress.total > 1
                    ? `${batchProgress.current} / ${batchProgress.total}...`
                    : t("keywords.analyzing"))
                : (isBatch ? t("keywords.researchBatch", { n: parsedKeywords.length }) : t("keywords.research"))}
            </Button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {research.isPending && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-sm">
            {batchProgress && batchProgress.total > 1
              ? t("keywords.batchProcessing", { current: batchProgress.current, total: batchProgress.total, kw: batchProgress.currentKw })
              : t("keywords.searching")}
          </p>
          <p className="text-xs mt-1">{t("keywords.searchTime")}</p>
        </div>
      )}

      {/* Results */}
      {results && !research.isPending && <ResearchResults data={results} />}

      {/* Empty State */}
      {!results && !research.isPending && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Search className="h-14 w-14 opacity-20 mb-4" />
          <p className="text-sm">{t("keywords.enterKeyword")}</p>
          <p className="text-xs mt-1">{t("keywords.weWillAnalyze")}</p>
        </div>
      )}
    </div>
  );
}
