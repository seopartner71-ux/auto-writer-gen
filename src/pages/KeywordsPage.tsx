import { useState, useMemo } from "react";
import { useMutation } from "@tanstack/react-query";
import { useI18n } from "@/shared/hooks/useI18n";
import { supabase } from "@/integrations/supabase/client";
import { sanitizeKeyword, validateKeywordInput } from "@/shared/utils/sanitizeKeyword";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, Globe, MapPin } from "lucide-react";
import { toast } from "sonner";
import { ResearchResults } from "@/components/research/ResearchResults";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";

const GEO_OPTIONS = [
  { value: "us", labelKey: "geo.us", cities: ["New York", "Los Angeles", "Chicago", "Houston", "Miami", "San Francisco", "Seattle", "Boston"] },
  { value: "gb", labelKey: "geo.gb", cities: ["London", "Manchester", "Birmingham", "Leeds", "Edinburgh", "Glasgow"] },
  { value: "de", labelKey: "geo.de", cities: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart"] },
  { value: "fr", labelKey: "geo.fr", cities: ["Paris", "Lyon", "Marseille", "Toulouse", "Nice", "Bordeaux"] },
  { value: "ru", labelKey: "geo.ru", cities: ["Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Краснодар"] },
  { value: "ua", labelKey: "geo.ua", cities: ["Київ", "Харків", "Одеса", "Дніпро", "Львів", "Запоріжжя"] },
  { value: "br", labelKey: "geo.br", cities: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Curitiba"] },
  { value: "in", labelKey: "geo.in", cities: ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata"] },
  { value: "jp", labelKey: "geo.jp", cities: ["Tokyo", "Osaka", "Yokohama", "Nagoya", "Kyoto", "Fukuoka"] },
  { value: "es", labelKey: "geo.es", cities: ["Madrid", "Barcelona", "Valencia", "Seville", "Málaga", "Bilbao"] },
  { value: "co", labelKey: "geo.co", cities: ["Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga"] },
];

const LANG_OPTIONS = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
  { value: "es-CO", label: "Español (Colombia)" },
  { value: "pt", label: "Português" },
  { value: "ja", label: "日本語" },
  { value: "uk", label: "Українська" },
];

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
  const { t } = useI18n();
  const [keyword, setKeyword] = useState("");
  const [geo, setGeo] = useState("ru");
  const [geoMode, setGeoMode] = useState<"country" | "city">("country");
  const [city, setCity] = useState("");
  const [language, setLanguage] = useState("ru");
  const [results, setResults] = useState<ResearchData | null>(null);

  const currentCities = useMemo(() => {
    return GEO_OPTIONS.find((o) => o.value === geo)?.cities || [];
  }, [geo]);

  const research = useMutation({
    mutationFn: async () => {
      const clean = sanitizeKeyword(keyword);
      const vErr = validateKeywordInput(clean);
      if (vErr) throw new Error(vErr === "too_short" ? "Слишком короткий запрос" : "Слишком длинный запрос");
      const { data, error } = await supabase.functions.invoke("smart-research", {
        body: { keyword: clean, geo, language, ...(geoMode === "city" && city ? { city } : {}) },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as ResearchData;
    },
    onSuccess: (data) => {
      setResults(data);
      toast.success(`${t("keywords.analysisComplete")} (${data.model_used})`);
    },
    onError: (e) => toast.error(e.message),
  });

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

      {/* Search Form */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="flex flex-col gap-3">
          <div className="space-y-1.5 max-w-xl">
            <Label className="text-xs text-muted-foreground">{t("keywords.keyword")}</Label>
            <Input
              placeholder={t("keywords.keywordPlaceholder")}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && keyword.trim().length >= 2 && research.mutate()}
            />
          </div>
          <div className="flex items-end gap-3 flex-wrap">
            <Tabs value={geoMode} onValueChange={(v) => { setGeoMode(v as "country" | "city"); setCity(""); }} className="w-auto self-center">
              <TabsList className="h-8 p-0.5">
                <TabsTrigger value="country" className="text-xs px-2.5 h-7 gap-1">
                  <Globe className="h-3 w-3" /> {t("geo.country")}
                </TabsTrigger>
                <TabsTrigger value="city" className="text-xs px-2.5 h-7 gap-1">
                  <MapPin className="h-3 w-3" /> {t("geo.city")}
                </TabsTrigger>
              </TabsList>
            </Tabs>
            <Select value={geo} onValueChange={(v) => { setGeo(v); setCity(""); }}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GEO_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{t(o.labelKey)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            {geoMode === "city" && (
              <Select value={city} onValueChange={setCity}>
                <SelectTrigger className="w-[180px]">
                  <SelectValue placeholder={t("geo.selectCity")} />
                </SelectTrigger>
                <SelectContent>
                  {currentCities.map((c) => (
                    <SelectItem key={c} value={c}>{c}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}
            <Select value={language} onValueChange={setLanguage}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {LANG_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button
              disabled={keyword.trim().length < 2 || research.isPending}
              onClick={() => research.mutate()}
            >
              {research.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Globe className="h-4 w-4 mr-2" />
              )}
              {research.isPending ? t("keywords.analyzing") : t("keywords.research")}
            </Button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {research.isPending && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-sm">{t("keywords.searching")}</p>
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
