import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import {
  Target, Lightbulb, HelpCircle, Hash, BarChart3, FileText,
  ExternalLink, ChevronDown, ChevronUp, ListTree, ArrowRight
} from "lucide-react";
import type { ResearchData, Competitor } from "@/pages/KeywordsPage";
import { useI18n } from "@/shared/hooks/useI18n";

interface Props {
  data: ResearchData;
}

const INTENT_COLORS: Record<string, string> = {
  informational: "bg-info/20 text-info",
  transactional: "bg-success/20 text-success",
  navigational: "bg-warning/20 text-warning",
  commercial: "bg-primary/20 text-primary",
};

const DIFFICULTY_COLORS: Record<string, string> = {
  easy: "bg-success/20 text-success",
  medium: "bg-warning/20 text-warning",
  hard: "bg-destructive/20 text-destructive",
  very_hard: "bg-destructive/30 text-destructive",
};

const INTENT_KEYS: Record<string, string> = {
  informational: "research.intentInformational",
  transactional: "research.intentTransactional",
  navigational: "research.intentNavigational",
  commercial: "research.intentCommercial",
};

const DIFFICULTY_KEYS: Record<string, string> = {
  easy: "research.diffEasy",
  medium: "research.diffMedium",
  hard: "research.diffHard",
  very_hard: "research.diffVeryHard",
};

// Detect non-organic site types by domain patterns
const SITE_TYPE_PATTERNS: { pattern: RegExp; key: string }[] = [
  { pattern: /facebook\.com|instagram\.com|twitter\.com|x\.com|linkedin\.com|pinterest\.com|tiktok\.com|reddit\.com|vk\.com|t\.me/i, key: "research.siteType.social" },
  { pattern: /youtube\.com|youtu\.be|vimeo\.com|dailymotion\.com|rumble\.com/i, key: "research.siteType.video" },
  { pattern: /tripadvisor\.|yelp\.|booking\.com|expedia\.|hotels\.com|airbnb\.|kayak\.|agoda\./i, key: "research.siteType.aggregator" },
  { pattern: /wikipedia\.org|wikimedia\.org/i, key: "research.siteType.wiki" },
  { pattern: /amazon\.|ebay\.|aliexpress\.|walmart\./i, key: "research.siteType.marketplace" },
  { pattern: /quora\.com|stackexchange\.com|stackoverflow\.com/i, key: "research.siteType.qa" },
  { pattern: /maps\.google|google\.com\/maps/i, key: "research.siteType.maps" },
  { pattern: /news\.google|news\.yahoo/i, key: "research.siteType.news" },
];

function getSiteTypeKey(url: string): string | null {
  for (const { pattern, key } of SITE_TYPE_PATTERNS) {
    if (pattern.test(url)) return key;
  }
  return null;
}

export function ResearchResults({ data }: Props) {
  const { t } = useI18n();
  const navigate = useNavigate();
  const { analysis, competitors: initialCompetitors } = data;
  const [competitors, setCompetitors] = useState<Competitor[]>(
    initialCompetitors.map((c) => ({ ...c, excluded: false }))
  );
  const [showAllCompetitors, setShowAllCompetitors] = useState(false);

  const toggleExclude = (position: number) => {
    setCompetitors((prev) =>
      prev.map((c) => (c.position === position ? { ...c, excluded: !c.excluded } : c))
    );
  };

  const intentKey = INTENT_KEYS[analysis.intent] || INTENT_KEYS.informational;
  const intentColor = INTENT_COLORS[analysis.intent] || INTENT_COLORS.informational;
  const difficultyKey = DIFFICULTY_KEYS[analysis.difficulty_estimate] || DIFFICULTY_KEYS.medium;
  const difficultyColor = DIFFICULTY_COLORS[analysis.difficulty_estimate] || DIFFICULTY_COLORS.medium;

  const visibleCompetitors = showAllCompetitors ? competitors : competitors.slice(0, 5);

  return (
    <div className="space-y-6 animate-fade-in">
      {/* Overview Cards */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">{t("research.intent")}</div>
            <Badge className={`${intentColor} border-0`}>{t(intentKey)}</Badge>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">{t("research.difficulty")}</div>
            <Badge className={`${difficultyColor} border-0`}>{t(difficultyKey)}</Badge>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">{t("research.recVolume")}</div>
            <span className="text-lg font-semibold">{analysis.recommended_word_count.toLocaleString()}</span>
            <span className="text-xs text-muted-foreground ml-1">{t("research.words")}</span>
          </CardContent>
        </Card>
        <Card className="bg-card border-border">
          <CardContent className="p-4">
            <div className="text-xs text-muted-foreground mb-1">{t("research.lsiKeys")}</div>
            <span className="text-lg font-semibold">{analysis.lsi_keywords.length}</span>
            <span className="text-xs text-muted-foreground ml-1">{t("research.found")}</span>
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Competitors */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <BarChart3 className="h-4 w-4 text-primary" />
              {t("research.competitors")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {visibleCompetitors.map((c) => (
              <div
                key={c.position}
                className={`flex items-start gap-3 rounded-md p-3 transition-colors ${
                  c.excluded ? "bg-muted/30 opacity-50" : "bg-muted/50"
                }`}
              >
                <span className="text-xs font-mono text-muted-foreground w-5 shrink-0 pt-0.5">
                  #{c.position}
                </span>
              <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <a
                      href={c.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`text-sm font-medium hover:text-primary truncate flex items-center gap-1 ${
                        getSiteTypeKey(c.url) ? "text-destructive" : ""
                      }`}
                    >
                      {c.title}
                      <ExternalLink className="h-3 w-3 shrink-0" />
                    </a>
                    {getSiteTypeKey(c.url) && (
                      <Badge className="bg-destructive/15 text-destructive border-destructive/30 text-[10px] px-1.5 py-0 shrink-0">
                        {t(getSiteTypeKey(c.url)!)}
                      </Badge>
                    )}
                  </div>
                  <p className="text-xs text-muted-foreground mt-0.5 line-clamp-2">
                    {c.snippet}
                  </p>
                  <p className="text-[10px] text-muted-foreground/60 mt-0.5 truncate font-mono">
                    {c.url}
                  </p>
                </div>
                <div className="shrink-0 flex items-center gap-1">
                  <span className="text-[10px] text-muted-foreground">
                    {c.excluded ? t("research.excluded") : t("research.active")}
                  </span>
                  <Switch
                    checked={!c.excluded}
                    onCheckedChange={() => toggleExclude(c.position)}
                  />
                </div>
              </div>
            ))}
            {competitors.length > 5 && (
              <Button
                variant="ghost"
                size="sm"
                className="w-full"
                onClick={() => setShowAllCompetitors(!showAllCompetitors)}
              >
                {showAllCompetitors ? (
                  <>
                    <ChevronUp className="h-3 w-3 mr-1" /> {t("research.collapse")}
                  </>
                ) : (
                  <>
                    <ChevronDown className="h-3 w-3 mr-1" /> {t("research.showMoreN", { n: competitors.length - 5 })}
                  </>
                )}
              </Button>
            )}
          </CardContent>
        </Card>

        {/* Must Cover + Content Gaps */}
        <div className="space-y-4">
          {/* Must Cover Topics */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Target className="h-4 w-4 text-success" />
                {t("research.mustCover")}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <div className="flex flex-wrap gap-1.5">
                {analysis.must_cover_topics.map((topic, i) => (
                  <Badge key={i} variant="secondary" className="text-xs">
                    {topic}
                  </Badge>
                ))}
              </div>
            </CardContent>
          </Card>

          {/* Content Gaps */}
          <Card className="bg-card border-border">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm flex items-center gap-2">
                <Lightbulb className="h-4 w-4 text-warning" />
                {t("research.contentGaps")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-2">
              {analysis.content_gaps.map((gap, i) => (
                <div key={i} className="rounded-md bg-muted/50 p-3">
                  <p className="text-sm font-medium">{gap.topic}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{gap.reason}</p>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Top Questions */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <HelpCircle className="h-4 w-4 text-info" />
              {t("research.topQuestions")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {analysis.top_questions.map((q, i) => (
              <div key={i} className="flex items-start gap-2 text-sm">
                <span className="text-xs text-muted-foreground font-mono w-4 shrink-0">{i + 1}.</span>
                <span>{q}</span>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* LSI Keywords */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <Hash className="h-4 w-4 text-primary" />
              {t("research.lsiKeywords")}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-1.5">
              {analysis.lsi_keywords.map((kw, i) => (
                <Badge key={i} variant="outline" className="text-xs font-mono">
                  {kw}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>

        {/* Recommended Headings */}
        <Card className="bg-card border-border">
          <CardHeader className="pb-3">
            <CardTitle className="text-sm flex items-center gap-2">
              <ListTree className="h-4 w-4 text-accent" />
              {t("research.recStructure")}
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-1.5">
            {analysis.recommended_headings.map((h, i) => (
              <div key={i} className="flex items-center gap-2 text-sm">
                <FileText className="h-3 w-3 text-muted-foreground shrink-0" />
                <span>{h}</span>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>

      {/* Navigation to Plan Builder */}
      <div className="flex justify-end pt-2">
        <Button
          size="lg"
          className="gap-2"
          onClick={() => navigate("/plan-builder")}
        >
          {t("research.goToStructure")}
          <ArrowRight className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
