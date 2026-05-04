import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import DOMPurify from "dompurify";
import { markdownToPreviewHtml } from "@/pages/articles/utils";
import { Card } from "@/components/ui/card";
import { Loader2, FileText } from "lucide-react";

interface Article {
  id: string; title: string | null; content: string | null;
  meta_description: string | null; created_at: string;
}

export default function PublicArticlePage() {
  const { token } = useParams<{ token: string }>();
  const [article, setArticle] = useState<Article | null>(null);
  const [loading, setLoading] = useState(true);
  const [notFound, setNotFound] = useState(false);

  useEffect(() => {
    if (!token) { setNotFound(true); setLoading(false); return; }
    (async () => {
      const { data } = await supabase
        .from("articles")
        .select("id, title, content, meta_description, created_at")
        .eq("share_token", token)
        .eq("is_public", true)
        .maybeSingle();
      if (!data) setNotFound(true);
      else setArticle(data);
      setLoading(false);
    })();
  }, [token]);

  useEffect(() => {
    if (!article) return;
    document.title = `${article.title || "Статья"} - SEO-Module`;
    if (article.meta_description) {
      let m = document.querySelector('meta[name="description"]');
      if (!m) { m = document.createElement("meta"); m.setAttribute("name", "description"); document.head.appendChild(m); }
      m.setAttribute("content", article.meta_description);
    }
  }, [article]);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center">
        <Loader2 className="w-8 h-8 animate-spin text-primary" />
      </div>
    );
  }

  if (notFound || !article) {
    return (
      <div className="min-h-screen grid place-items-center px-4">
        <Card className="p-8 max-w-md text-center space-y-3">
          <FileText className="w-10 h-10 mx-auto text-muted-foreground" />
          <h1 className="text-xl font-semibold">Статья не найдена</h1>
          <p className="text-sm text-muted-foreground">Ссылка устарела или автор закрыл доступ.</p>
        </Card>
      </div>
    );
  }

  const html = DOMPurify.sanitize(markdownToPreviewHtml(article.content || ""));

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-3xl mx-auto px-4 py-12">
        <header className="mb-8 pb-6 border-b border-border/40">
          <h1 className="text-3xl md:text-4xl font-bold leading-tight mb-3">{article.title || "Без заголовка"}</h1>
          <div className="text-xs text-muted-foreground">
            {new Date(article.created_at).toLocaleDateString("ru-RU", { year: "numeric", month: "long", day: "numeric" })}
          </div>
        </header>
        <article
          className="prose prose-invert max-w-none prose-headings:font-semibold prose-a:text-primary prose-img:rounded-lg"
          dangerouslySetInnerHTML={{ __html: html }}
        />
        <footer className="mt-16 pt-6 border-t border-border/40 text-center text-xs text-muted-foreground">
          Опубликовано через <a href="/" className="text-primary hover:underline">SEO-Module</a>
        </footer>
      </div>
    </div>
  );
}
