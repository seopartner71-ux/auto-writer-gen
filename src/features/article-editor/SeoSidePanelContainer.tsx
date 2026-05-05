import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { SeoSidePanel } from "./SeoSidePanel";

interface SeoSidePanelContainerProps {
  content: string;
  selectedKeyword: any | null;
  selectedKeywordId: string;
  articleId: string | null;
  onContentImproved: (content: string) => void;
}

/**
 * Container around SeoSidePanel: owns SERP benchmark query and term derivation.
 * Extracted from ArticlesPage as part of Step 3 refactor.
 */
export function SeoSidePanelContainer({
  content,
  selectedKeyword,
  selectedKeywordId,
  articleId,
  onContentImproved,
}: SeoSidePanelContainerProps) {
  const { data: serpBenchmark } = useQuery({
    queryKey: ["serp-benchmark", selectedKeywordId],
    queryFn: async () => {
      if (!selectedKeywordId) return null;
      const { data } = await supabase
        .from("serp_results")
        .select("deep_analysis")
        .eq("keyword_id", selectedKeywordId)
        .not("deep_analysis", "is", null)
        .limit(1)
        .maybeSingle();
      const cached = (data?.deep_analysis as any)?._cached_result?.benchmark;
      if (!cached) return null;
      return {
        medianWordCount: cached.median_word_count ?? cached.target_word_count ?? null,
        medianH2: cached.median_h2_count ?? cached.target_h2_count ?? null,
        medianLists: cached.median_paragraph_count ?? null,
        medianKeywordDensity: cached.median_keyword_density ?? null,
      };
    },
    enabled: !!selectedKeywordId,
    staleTime: 5 * 60 * 1000,
  });

  const seoPanelTerms: string[] = [
    ...((selectedKeyword?.must_cover_topics as string[]) || []),
    ...(((selectedKeyword?.content_gaps as any[]) || []).map((g: any) => typeof g === "string" ? g : g?.topic || g?.title).filter(Boolean)),
    ...(((selectedKeyword?.lsi_keywords as string[]) || []).slice(0, 20)),
  ];

  return (
    <SeoSidePanel
      content={content}
      keyword={selectedKeyword?.seed_keyword || null}
      terms={seoPanelTerms}
      benchmark={serpBenchmark || null}
      hasKeyword={!!selectedKeywordId}
      articleId={articleId}
      onContentImproved={onContentImproved}
    />
  );
}