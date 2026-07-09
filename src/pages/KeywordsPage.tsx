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

const GEO_OPTIONS = [
  { value: "us", labelKey: "geo.us", cities: ["New York", "Los Angeles", "Chicago", "Houston", "Miami", "San Francisco", "Seattle", "Boston", "Dallas", "Denver", "Atlanta", "Phoenix", "Philadelphia", "San Diego", "Austin", "Las Vegas"] },
  { value: "gb", labelKey: "geo.gb", cities: ["London", "Manchester", "Birmingham", "Leeds", "Edinburgh", "Glasgow", "Liverpool", "Bristol", "Cardiff", "Belfast"] },
  { value: "de", labelKey: "geo.de", cities: ["Berlin", "Munich", "Hamburg", "Frankfurt", "Cologne", "Stuttgart", "Düsseldorf", "Dresden", "Leipzig", "Hannover"] },
  { value: "fr", labelKey: "geo.fr", cities: ["Paris", "Lyon", "Marseille", "Toulouse", "Nice", "Bordeaux", "Nantes", "Strasbourg", "Montpellier", "Lille"] },
  { value: "ru", labelKey: "geo.ru", cities: ["Москва", "Санкт-Петербург", "Новосибирск", "Екатеринбург", "Казань", "Краснодар", "Нижний Новгород", "Самара", "Ростов-на-Дону", "Уфа", "Челябинск", "Воронеж", "Красноярск", "Пермь", "Волгоград", "Тюмень"] },
  { value: "ua", labelKey: "geo.ua", cities: ["Київ", "Харків", "Одеса", "Дніпро", "Львів", "Запоріжжя", "Вінниця", "Полтава", "Чернігів", "Миколаїв"] },
  { value: "br", labelKey: "geo.br", cities: ["São Paulo", "Rio de Janeiro", "Brasília", "Salvador", "Curitiba", "Belo Horizonte", "Fortaleza", "Recife", "Porto Alegre", "Manaus"] },
  { value: "in", labelKey: "geo.in", cities: ["Mumbai", "Delhi", "Bangalore", "Hyderabad", "Chennai", "Kolkata", "Pune", "Ahmedabad", "Jaipur", "Lucknow"] },
  { value: "jp", labelKey: "geo.jp", cities: ["Tokyo", "Osaka", "Yokohama", "Nagoya", "Kyoto", "Fukuoka", "Sapporo", "Kobe", "Hiroshima", "Sendai"] },
  { value: "es", labelKey: "geo.es", cities: ["Madrid", "Barcelona", "Valencia", "Seville", "Málaga", "Bilbao", "Zaragoza", "Alicante", "Murcia", "Granada"] },
  { value: "co", labelKey: "geo.co", cities: ["Bogotá", "Medellín", "Cali", "Barranquilla", "Cartagena", "Bucaramanga", "Pereira", "Santa Marta", "Cúcuta", "Manizales"] },
  { value: "mx", labelKey: "geo.mx", cities: ["Ciudad de México", "Guadalajara", "Monterrey", "Cancún", "Puebla", "Tijuana", "Mérida", "León", "Querétaro", "Oaxaca"] },
  { value: "ar", labelKey: "geo.ar", cities: ["Buenos Aires", "Córdoba", "Rosario", "Mendoza", "Mar del Plata", "Tucumán", "La Plata", "Salta", "Bariloche"] },
  { value: "it", labelKey: "geo.it", cities: ["Rome", "Milan", "Naples", "Turin", "Florence", "Bologna", "Venice", "Genoa", "Palermo", "Verona"] },
  { value: "tr", labelKey: "geo.tr", cities: ["Istanbul", "Ankara", "Izmir", "Antalya", "Bursa", "Adana", "Konya", "Gaziantep"] },
  { value: "pl", labelKey: "geo.pl", cities: ["Warsaw", "Kraków", "Wrocław", "Gdańsk", "Poznań", "Łódź", "Katowice", "Lublin"] },
  { value: "kz", labelKey: "geo.kz", cities: ["Алматы", "Астана", "Шымкент", "Караганда", "Актобе", "Атырау", "Павлодар", "Семей"] },
  { value: "az", labelKey: "geo.az", cities: ["Баку", "Гянджа", "Сумгаит", "Мингечевир", "Ленкорань"] },
  { value: "ge", labelKey: "geo.ge", cities: ["Тбилиси", "Батуми", "Кутаиси", "Рустави", "Зугдиди"] },
  { value: "uz", labelKey: "geo.uz", cities: ["Ташкент", "Самарканд", "Бухара", "Наманган", "Фергана", "Андижан"] },
  { value: "th", labelKey: "geo.th", cities: ["Bangkok", "Chiang Mai", "Pattaya", "Phuket", "Nakhon Ratchasima"] },
  { value: "id", labelKey: "geo.id", cities: ["Jakarta", "Surabaya", "Bandung", "Medan", "Bali", "Semarang", "Makassar"] },
  { value: "vn", labelKey: "geo.vn", cities: ["Ho Chi Minh City", "Hanoi", "Da Nang", "Hai Phong", "Can Tho", "Nha Trang"] },
  { value: "ae", labelKey: "geo.ae", cities: ["Dubai", "Abu Dhabi", "Sharjah", "Ajman", "Ras Al Khaimah"] },
  { value: "sa", labelKey: "geo.sa", cities: ["Riyadh", "Jeddah", "Mecca", "Medina", "Dammam"] },
  { value: "au", labelKey: "geo.au", cities: ["Sydney", "Melbourne", "Brisbane", "Perth", "Adelaide", "Gold Coast", "Canberra"] },
  { value: "ca", labelKey: "geo.ca", cities: ["Toronto", "Vancouver", "Montreal", "Calgary", "Ottawa", "Edmonton", "Winnipeg"] },
  { value: "nl", labelKey: "geo.nl", cities: ["Amsterdam", "Rotterdam", "The Hague", "Utrecht", "Eindhoven"] },
  { value: "kr", labelKey: "geo.kr", cities: ["Seoul", "Busan", "Incheon", "Daegu", "Daejeon", "Gwangju"] },
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
  { value: "it", label: "Italiano" },
  { value: "pl", label: "Polski" },
  { value: "tr", label: "Türkçe" },
  { value: "nl", label: "Nederlands" },
  { value: "ko", label: "한국어" },
  { value: "ar", label: "العربية" },
  { value: "hi", label: "हिन्दी" },
  { value: "th", label: "ไทย" },
  { value: "vi", label: "Tiếng Việt" },
  { value: "id", label: "Bahasa Indonesia" },
  { value: "kk", label: "Қазақша" },
  { value: "az", label: "Azərbaycan" },
  { value: "ka", label: "ქართული" },
  { value: "uz", label: "O'zbek" },
  { value: "zh", label: "中文" },
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
        if (vErr) { failed++; toast.error(`"${raw}": ${vErr === "too_short" ? "слишком короткий" : "слишком длинный"}`); continue; }
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
          toast.error(`"${clean}": ${e?.message || "ошибка"}`);
        }
      }
      setBatchProgress(null);
      if (!lastResult) throw new Error("Все запросы завершились с ошибкой");
      (lastResult as any).__batchStats = { ok, failed, total: list.length };
      return lastResult;
    },
    onSuccess: (data) => {
      setResults(data);
      const stats = (data as any).__batchStats;
      if (stats && stats.total > 1) {
        toast.success(`Готово: ${stats.ok} из ${stats.total}${stats.failed ? ` (ошибок: ${stats.failed})` : ""}`);
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
                {isBatch ? `${parsedKeywords.length} / 10 запросов` : "До 10 запросов - по одному в строке"}
              </span>
            </Label>
            <Textarea
              placeholder={`${t("keywords.keywordPlaceholder")}\nможно несколько - каждый с новой строки`}
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
                      <SelectItem key={c} value={c}>{c}</SelectItem>
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
                : (isBatch ? `Исследовать (${parsedKeywords.length})` : t("keywords.research"))}
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
              ? `Обработка ${batchProgress.current} / ${batchProgress.total}: ${batchProgress.currentKw}`
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
