import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import DOMPurify from "dompurify";

interface Props {
  slug: string;
  fallbackTitle: string;
  fallback: React.ReactNode;
}

export function DynamicLegalPage({ slug, fallbackTitle, fallback }: Props) {
  const { data: page, isLoading } = useQuery({
    queryKey: ["legal-page", slug],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("legal_pages")
        .select("title, content")
        .eq("slug", slug)
        .single();
      if (error) throw error;
      return data;
    },
    staleTime: 60_000,
  });

  const hasDbContent = !isLoading && page?.content && page.content.trim().length > 0;

  return (
    <div className="min-h-screen bg-[#050505] text-foreground">
      <LandingNav />
      <div className="container mx-auto px-4 max-w-3xl pt-24 pb-20">
        <h1 className="text-3xl font-black mb-8" style={{ letterSpacing: "-0.04em" }}>
          {hasDbContent ? page.title || fallbackTitle : fallbackTitle}
        </h1>
        {hasDbContent ? (
          <div
            className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground/80 leading-relaxed"
            dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(page.content) }}
          />
        ) : (
          <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground/80 leading-relaxed">
            {fallback}
          </div>
        )}
      </div>
      <LandingFooter />
    </div>
  );
}
