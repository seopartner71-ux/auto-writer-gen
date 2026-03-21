import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { supabase } from "@/shared/api/supabase";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Search, Loader2, Globe } from "lucide-react";
import { toast } from "sonner";
import { ResearchResults } from "@/components/research/ResearchResults";

const GEO_OPTIONS = [
  { value: "us", label: "🇺🇸 США" },
  { value: "gb", label: "🇬🇧 Великобритания" },
  { value: "de", label: "🇩🇪 Германия" },
  { value: "fr", label: "🇫🇷 Франция" },
  { value: "ru", label: "🇷🇺 Россия" },
  { value: "ua", label: "🇺🇦 Украина" },
  { value: "br", label: "🇧🇷 Бразилия" },
  { value: "in", label: "🇮🇳 Индия" },
  { value: "jp", label: "🇯🇵 Япония" },
  { value: "es", label: "🇪🇸 Испания" },
];

const LANG_OPTIONS = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "de", label: "Deutsch" },
  { value: "fr", label: "Français" },
  { value: "es", label: "Español" },
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
  const [keyword, setKeyword] = useState("");
  const [geo, setGeo] = useState("us");
  const [language, setLanguage] = useState("en");
  const [results, setResults] = useState<ResearchData | null>(null);

  const research = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("smart-research", {
        body: { keyword: keyword.trim(), geo, language },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data as ResearchData;
    },
    onSuccess: (data) => {
      setResults(data);
      toast.success(`Анализ завершён (${data.model_used})`);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Search className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Smart Research</h1>
          <p className="text-sm text-muted-foreground">
            Анализ выдачи Google и интеллектуальная обработка конкурентов
          </p>
        </div>
      </div>

      {/* Search Form */}
      <div className="rounded-lg border border-border bg-card p-5">
        <div className="grid gap-4 sm:grid-cols-[1fr_auto_auto_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ключевое слово</Label>
            <Input
              placeholder="Например: best project management tools"
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && keyword.trim().length >= 2 && research.mutate()}
            />
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">ГЕО</Label>
            <Select value={geo} onValueChange={setGeo}>
              <SelectTrigger className="w-[160px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {GEO_OPTIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Язык</Label>
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
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">&nbsp;</Label>
            <Button
              className="w-full"
              disabled={keyword.trim().length < 2 || research.isPending}
              onClick={() => research.mutate()}
            >
              {research.isPending ? (
                <Loader2 className="h-4 w-4 mr-2 animate-spin" />
              ) : (
                <Globe className="h-4 w-4 mr-2" />
              )}
              {research.isPending ? "Анализ..." : "Исследовать"}
            </Button>
          </div>
        </div>
      </div>

      {/* Loading State */}
      {research.isPending && (
        <div className="flex flex-col items-center justify-center py-16 text-muted-foreground">
          <Loader2 className="h-10 w-10 animate-spin text-primary mb-4" />
          <p className="text-sm">Поиск в Google и анализ конкурентов...</p>
          <p className="text-xs mt-1">Это может занять 15-30 секунд</p>
        </div>
      )}

      {/* Results */}
      {results && !research.isPending && <ResearchResults data={results} />}

      {/* Empty State */}
      {!results && !research.isPending && (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground">
          <Search className="h-14 w-14 opacity-20 mb-4" />
          <p className="text-sm">Введите ключевое слово для начала исследования</p>
          <p className="text-xs mt-1">Мы проанализируем ТОП-10 Google и найдём Content Gaps</p>
        </div>
      )}
    </div>
  );
}
