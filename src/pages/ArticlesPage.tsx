import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { Separator } from "@/components/ui/separator";
import {
  Wand2, Loader2, Hash, FileText, Save, Code2, Trash2,
  CheckCircle2, Circle, BarChart3, BookOpen, Copy, Check, Download, Eye, Pencil, User, Target, Factory, Gem, Shield
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";
import { SeoBenchmark } from "@/features/seo-analysis/SeoBenchmark";
import { BulkGenerationMode } from "@/components/bulk/BulkGenerationMode";
import { ProImageGenerator } from "@/features/pro-image-gen/ProImageGenerator";
import { HumanScorePanel } from "@/components/article/HumanScorePanel";

// Readability helpers
function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countSentences(text: string): number {
  return (text.match(/[.!?]+/g) || []).length || 1;
}

function countSyllables(word: string): number {
  word = word.toLowerCase().replace(/[^a-zа-яё]/g, "");
  if (word.length <= 3) return 1;
  // Simple heuristic for Latin
  const matches = word.match(/[aeiouyаеёиоуыэюя]+/gi);
  return matches ? matches.length : 1;
}

function fleschScore(text: string): number {
  const words = countWords(text);
  if (words < 10) return 0;
  const sentences = countSentences(text);
  const syllables = text.split(/\s+/).reduce((sum, w) => sum + countSyllables(w), 0);
  const score = 206.835 - 1.015 * (words / sentences) - 84.6 * (syllables / words);
  return Math.max(0, Math.min(100, Math.round(score)));
}

function readabilityLabel(score: number): { label: string; color: string } {
  if (score >= 70) return { label: "Легко", color: "text-success" };
  if (score >= 50) return { label: "Средне", color: "text-warning" };
  return { label: "Сложно", color: "text-destructive" };
}

function markdownToPreviewHtml(md: string): string {
  // Handle tables first
  let html = md.replace(
    /(?:^|\n)((?:\|.+\|\s*\n)+)/g,
    (_, tableBlock: string) => {
      const rows = tableBlock.trim().split("\n").filter(Boolean);
      if (rows.length < 2) return tableBlock;
      const headerCells = rows[0].split("|").filter(c => c.trim());
      // Check if row 2 is separator
      const isSep = /^[\s|:-]+$/.test(rows[1]);
      const dataRows = isSep ? rows.slice(2) : rows.slice(1);
      let table = '<table class="md-table"><thead><tr>';
      headerCells.forEach(c => { table += `<th>${c.trim()}</th>`; });
      table += "</tr></thead><tbody>";
      dataRows.forEach(row => {
        const cells = row.split("|").filter(c => c.trim());
        table += "<tr>";
        cells.forEach(c => { table += `<td>${c.trim()}</td>`; });
        table += "</tr>";
      });
      table += "</tbody></table>";
      return "\n" + table + "\n";
    }
  );

  html = html
    .replace(/^######\s+(.+)$/gm, '<h6 class="md-h6">$1</h6>')
    .replace(/^#####\s+(.+)$/gm, '<h5 class="md-h5">$1</h5>')
    .replace(/^####\s+(.+)$/gm, '<h4 class="md-h4">$1</h4>')
    .replace(/^###\s+(.+)$/gm, '<h3 class="md-h3">$1</h3>')
    .replace(/^##\s+(.+)$/gm, '<h2 class="md-h2">$1</h2>')
    .replace(/^#\s+(.+)$/gm, '<h1 class="md-h1">$1</h1>')
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" class="md-img" style="max-width:100%;height:auto;border-radius:8px;margin:1rem 0" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" class="md-link">$1</a>')
    .replace(/^[-*]\s+(.+)$/gm, '<li class="md-ul-li">$1</li>')
    .replace(/^\d+\.\s+(.+)$/gm, '<li class="md-ol-li">$1</li>');

  // Wrap consecutive ul/ol items
  html = html.replace(/((?:<li class="md-ul-li">.*?<\/li>\s*)+)/g, '<ul class="md-ul">$1</ul>');
  html = html.replace(/((?:<li class="md-ol-li">.*?<\/li>\s*)+)/g, '<ol class="md-ol">$1</ol>');

  // Paragraphs
  html = html.replace(/\n{2,}/g, '</p><p class="md-p">');
  html = `<p class="md-p">${html}</p>`;
  // Clean empty paragraphs
  html = html.replace(/<p class="md-p">\s*<\/p>/g, "");
  html = html.replace(/<p class="md-p">\s*(<h[1-6]|<ul|<ol|<table)/g, "$1");
  html = html.replace(/(<\/h[1-6]>|<\/ul>|<\/ol>|<\/table>)\s*<\/p>/g, "$1");

  return html;
}

function highlightHtml(code: string): string {
  const esc = code
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");

  return esc
    // Comments <!-- ... -->
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span style="color:hsl(var(--muted-foreground))">$1</span>')
    // Tags <tagname ...> and </tagname>
    .replace(/(&lt;\/?)([\w-]+)/g, '<span style="color:hsl(210,80%,65%)">$1$2</span>')
    // Attributes name=
    .replace(/\s([\w-]+)(=)/g, ' <span style="color:hsl(30,80%,65%)">$1</span>$2')
    // Attribute values "..."
    .replace(/(&quot;)(.*?)(&quot;)/g, '<span style="color:hsl(120,50%,60%)">$1$2$3</span>')
    // Closing >
    .replace(/(&gt;)/g, '<span style="color:hsl(210,80%,65%)">$1</span>');
}

function markdownToCleanHtml(md: string): string {
  // Handle tables first
  let html = md.replace(
    /(?:^|\n)((?:\|.+\|\s*\n)+)/g,
    (_, tableBlock: string) => {
      const rows = tableBlock.trim().split("\n").filter(Boolean);
      if (rows.length < 2) return tableBlock;
      const headerCells = rows[0].split("|").filter(c => c.trim());
      const isSep = /^[\s|:-]+$/.test(rows[1]);
      const dataRows = isSep ? rows.slice(2) : rows.slice(1);
      let table = "<table><thead><tr>";
      headerCells.forEach(c => { table += `<th>${c.trim()}</th>`; });
      table += "</tr></thead><tbody>";
      dataRows.forEach(row => {
        const cells = row.split("|").filter(c => c.trim());
        table += "<tr>";
        cells.forEach(c => { table += `<td>${c.trim()}</td>`; });
        table += "</tr>";
      });
      table += "</tbody></table>";
      return "\n" + table + "\n";
    }
  );

  html = html
    .replace(/^######\s+(.+)$/gm, "<h6>$1</h6>")
    .replace(/^#####\s+(.+)$/gm, "<h5>$1</h5>")
    .replace(/^####\s+(.+)$/gm, "<h4>$1</h4>")
    .replace(/^###\s+(.+)$/gm, "<h3>$1</h3>")
    .replace(/^##\s+(.+)$/gm, "<h2>$1</h2>")
    .replace(/^#\s+(.+)$/gm, "<h1>$1</h1>")
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;height:auto;" />')
    .replace(/^[-*]\s+(.+)$/gm, "<li>$1</li>")
    .replace(/^\d+\.\s+(.+)$/gm, "<li>$1</li>")
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\n{2,}/g, "\n</p>\n<p>\n")
    .replace(/\n/g, "<br>\n");

  html = html.replace(/((?:<li>.*<\/li>\s*)+)/g, "<ul>$1</ul>");
  html = `<p>${html}</p>`;

  // Clean empty paragraphs
  html = html.replace(/<p>\s*<\/p>/g, "");
  html = html.replace(/<p>\s*(<h[1-6]|<ul|<ol|<table)/g, "$1");
  html = html.replace(/(<\/h[1-6]>|<\/ul>|<\/ol>|<\/table>)\s*<\/p>/g, "$1");
  html = html.replace(/<p>\s*<br>\s*<\/p>/g, "");

  return html.trim();
}

function markdownToFullHtml(md: string, title?: string, metaDesc?: string): string {
  const body = markdownToCleanHtml(md);
  return `<!DOCTYPE html>
<html lang="ru">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title || "Article"}</title>
  ${metaDesc ? `<meta name="description" content="${metaDesc.replace(/"/g, "&quot;")}">` : ""}
  <style>
    body { font-family: system-ui, sans-serif; max-width: 800px; margin: 2rem auto; padding: 0 1rem; line-height: 1.7; color: #1a1a1a; }
    h1 { font-size: 2rem; margin-top: 2rem; }
    h2 { font-size: 1.5rem; margin-top: 1.5rem; border-bottom: 1px solid #e5e5e5; padding-bottom: .3rem; }
    h3 { font-size: 1.25rem; margin-top: 1.2rem; }
    ul { padding-left: 1.5rem; }
    a { color: #2563eb; }
    strong { font-weight: 600; }
    table { border-collapse: collapse; width: 100%; margin: 1rem 0; }
    th, td { border: 1px solid #e5e5e5; padding: .5rem .75rem; text-align: left; }
    th { background: #f5f5f5; font-weight: 600; }
  </style>
</head>
<body>
${body}
</body>
</html>`;
}


export default function ArticlesPage() {
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const { limits } = usePlanLimits();
  const [mode, setMode] = useState<"single" | "bulk">("single");

  // Data fetching
  const { data: keywords = [] } = useQuery({
    queryKey: ["keywords-for-writer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("keywords")
        .select("*")
        .not("intent", "is", null)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  const { data: authorProfiles = [] } = useQuery({
    queryKey: ["author-profiles-for-writer"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("author_profiles")
        .select("*")
        .order("name");
      if (error) throw error;
      return data;
    },
  });

  const { data: savedArticles = [] } = useQuery({
    queryKey: ["articles-list"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("id, title, status, created_at, keyword_id")
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data;
    },
  });

  // Auto-select single author profile
  useEffect(() => {
    if (authorProfiles.length === 1 && !selectedAuthorId) {
      setSelectedAuthorId(authorProfiles[0].id);
    }
  }, [authorProfiles]);

  // Load article for editing from ?edit= query param
  useEffect(() => {
    const editId = searchParams.get("edit");
    if (!editId) return;

    const loadArticle = async () => {
      const { data, error } = await supabase
        .from("articles")
        .select("*")
        .eq("id", editId)
        .single();
      if (error || !data) return;

      setContent(data.content || "");
      setTitle(data.title || "");
      setMetaDescription(data.meta_description || "");
      setCurrentArticleId(data.id);
      if (data.keyword_id) setSelectedKeywordId(data.keyword_id);
      if (data.author_profile_id) setSelectedAuthorId(data.author_profile_id);
      // Clear the param so it doesn't reload on re-render
      setSearchParams({}, { replace: true });
      toast.info("Статья загружена для редактирования");
    };
    loadArticle();
  }, [searchParams]);

  // State
  const [selectedKeywordId, setSelectedKeywordId] = useState("");
  const [selectedAuthorId, setSelectedAuthorId] = useState("");
  const [outline, setOutline] = useState<{ text: string; level: string }[]>([]);
  const [content, setContent] = useState("");
  const [title, setTitle] = useState("");
  const [h1, setH1] = useState("");
  const [metaDescription, setMetaDescription] = useState("");
  const [isStreaming, setIsStreaming] = useState(false);
  const [schemaJson, setSchemaJson] = useState<string>("");
  const [schemaCopied, setSchemaCopied] = useState(false);
  const [faqTextBlock, setFaqTextBlock] = useState<string>("");
  const [faqCopied, setFaqCopied] = useState(false);
  const [schemaGenerating, setSchemaGenerating] = useState(false);
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const selectedKeyword = keywords.find((k: any) => k.id === selectedKeywordId);
  const lsiKeywords: string[] = (selectedKeyword?.lsi_keywords as string[]) || [];

  // Auto-generate SEO Title via AI
  const generateSeoTitle = useCallback(async (articleContent: string) => {
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const token = s?.access_token;
      if (!token) return;

      const keyword = selectedKeyword?.seed_keyword || "";
      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-title`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({ keyword, content: articleContent }),
      });
      if (!resp.ok) return;
      const data = await resp.json();
      if (data.title) setTitle(data.title);
      if (data.h1) setH1(data.h1);
    } catch {
      // Title generation is best-effort; fallback to H1
    }
  }, [selectedKeyword]);

  // Auto-generate and insert images into article content
  const autoInsertImages = useCallback(async (articleContent: string) => {
    try {
      const { data: { session: s } } = await supabase.auth.getSession();
      const token = s?.access_token;
      if (!token) return;

      // Check if user is Pro
      const { data: profile } = await supabase.from("profiles").select("plan").eq("id", s.user?.id).single();
      if (profile?.plan !== "pro") return;

      // Check if article has H2 headings
      const h2Count = (articleContent.match(/^##\s+/gm) || []).length;
      if (h2Count === 0) return;

      toast.info("Генерируем иллюстрации для статьи...");

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-pro-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          title: selectedKeyword?.seed_keyword || "",
          content: articleContent,
          style: "photorealistic",
          keyword: selectedKeyword?.seed_keyword || "",
          mode: "multi",
          max_images: 3,
        }),
      });

      if (!resp.ok) return;

      const data = await resp.json();
      const images = data.images;

      if (images?.length > 0) {
        setContent(prev => {
          let result = prev;
          for (let i = images.length - 1; i >= 0; i--) {
            const img = images[i];
            const headingPattern = new RegExp(
              `(^##\\s+${img.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$)`,
              'm'
            );
            const match = result.match(headingPattern);
            if (match && match.index !== undefined) {
              const insertPos = match.index + match[0].length;
              result = result.slice(0, insertPos) + `\n\n![${img.alt}](${img.url})\n` + result.slice(insertPos);
            }
          }
          return result;
        });
        toast.success(`Вставлено ${images.length} иллюстраций`);
      }
    } catch {
      // Best-effort, don't block the flow
    }
  }, [selectedKeyword]);

  // LSI keyword check
  const lsiStatus = useMemo(() => {
    const lower = content.toLowerCase();
    return lsiKeywords.map((kw) => ({
      keyword: kw,
      found: lower.includes(kw.toLowerCase()),
    }));
  }, [content, lsiKeywords]);

  const lsiFoundCount = lsiStatus.filter((s) => s.found).length;

  // SEO metrics
  const wordCount = useMemo(() => countWords(content), [content]);
  const readability = useMemo(() => fleschScore(content), [content]);
  const readInfo = readabilityLabel(readability);

  // Stream article generation
  const handleGenerate = useCallback(async () => {
    if (!selectedKeywordId) {
      toast.error("Выберите ключевое слово");
      return;
    }

    setIsStreaming(true);
    setContent("");
    setSchemaJson("");

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Refresh session to ensure fresh token
      const { data: { session: freshSession }, error: refreshError } = await supabase.auth.refreshSession();
      const token = freshSession?.access_token;
      if (refreshError || !token) throw new Error("Not authenticated");

      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
      const resp = await fetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          keyword_id: selectedKeywordId,
          author_profile_id: selectedAuthorId || null,
          outline,
          lsi_keywords: lsiKeywords,
          competitor_tables: (selectedKeyword as any)?.competitor_tables || [],
          competitor_lists: (selectedKeyword as any)?.competitor_lists || [],
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      if (!resp.body) throw new Error("No stream body");

      const reader = resp.body.getReader();
      const decoder = new TextDecoder();
      let buffer = "";
      let fullContent = "";

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });

        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) !== -1) {
          let line = buffer.slice(0, newlineIndex);
          buffer = buffer.slice(newlineIndex + 1);

          if (line.endsWith("\r")) line = line.slice(0, -1);
          if (line.startsWith(":") || line.trim() === "") continue;
          if (!line.startsWith("data: ")) continue;

          const jsonStr = line.slice(6).trim();
          if (jsonStr === "[DONE]") break;

          try {
            const parsed = JSON.parse(jsonStr);
            const delta = parsed.choices?.[0]?.delta?.content;
            if (delta) {
              fullContent += delta;
              setContent(fullContent);
            }
          } catch {
            buffer = line + "\n" + buffer;
            break;
          }
        }
      }

      // Auto-fill title and meta from generated content

      // Auto-generate meta description from first paragraph
      const paragraphs = fullContent
        .replace(/^#.+$/gm, "")
        .split(/\n\n+/)
        .map((p: string) => p.trim())
        .filter((p: string) => p.length > 30);
      if (paragraphs.length > 0) {
        setMetaDescription(paragraphs[0].replace(/[*_#`]/g, "").slice(0, 160));
      }

      // Auto-generate SEO Title via AI (async, best-effort)
      generateSeoTitle(fullContent);

      toast.success("Статья сгенерирована");

      // Auto-generate FAQ & JSON-LD schema (async, best-effort)
      autoGenerateSchema(fullContent, title);

      // Auto-generate and insert images (async, best-effort, PRO only)
      autoInsertImages(fullContent);
    } catch (e: any) {
      if (e.name === "AbortError") {
        toast.info("Генерация остановлена");
      } else {
        toast.error(e.message);
      }
    } finally {
      setIsStreaming(false);
      abortRef.current = null;
    }
  }, [selectedKeywordId, selectedAuthorId, outline, lsiKeywords]);

  const handleStop = () => abortRef.current?.abort();

  // Save article
  const saveArticle = useMutation({
    mutationFn: async () => {
      const session = await supabase.auth.getSession();
      const userId = session.data.session?.user?.id;
      if (!userId) throw new Error("Not authenticated");

      const payload = {
        user_id: userId,
        keyword_id: selectedKeywordId || null,
        author_profile_id: selectedAuthorId || null,
        title: title || null,
        content,
        meta_description: metaDescription || null,
        seo_score: {
          readability,
          wordCount,
          lsiCoverage: lsiKeywords.length > 0 ? Math.round((lsiFoundCount / lsiKeywords.length) * 100) : 0,
        },
        status: "draft",
      };

      if (currentArticleId) {
        const { error } = await supabase
          .from("articles")
          .update(payload)
          .eq("id", currentArticleId);
        if (error) throw error;
        return currentArticleId;
      } else {
        const { data, error } = await supabase
          .from("articles")
          .insert(payload)
          .select("id")
          .single();
        if (error) throw error;
        return data.id;
      }
    },
    onSuccess: (id) => {
      setCurrentArticleId(id);
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
      toast.success("Статья сохранена");
    },
    onError: (e) => toast.error(e.message),
  });

  // Generate schema
  const generateSchema = useMutation({
    mutationFn: async () => {
      const { data, error } = await supabase.functions.invoke("generate-schema", {
        body: {
          title,
          content,
          keyword: selectedKeyword?.seed_keyword,
          questions: selectedKeyword?.questions || [],
        },
      });
      if (error) throw error;
      if (data.error) throw new Error(data.error);
      return data;
    },
    onSuccess: (data) => {
      const schemas = [];
      if (data.article_schema) schemas.push(data.article_schema);
      if (data.faq_schema) schemas.push(data.faq_schema);
      setSchemaJson(JSON.stringify(schemas, null, 2));
      if (data.faq_text_block) setFaqTextBlock(data.faq_text_block);
      toast.success("FAQ и JSON-LD Schema сгенерированы");
    },
    onError: (e) => toast.error(e.message),
  });

  const copyToClipboard = (text: string, type: "schema" | "faq") => {
    const copyText = type === "schema" ? `<script type="application/ld+json">\n${text}\n</script>` : text;
    navigator.clipboard.writeText(copyText);
    if (type === "schema") {
      setSchemaCopied(true);
      setTimeout(() => setSchemaCopied(false), 2000);
    } else {
      setFaqCopied(true);
      setTimeout(() => setFaqCopied(false), 2000);
    }
  };

  // Auto-generate FAQ & schema after article generation
  const autoGenerateSchema = useCallback(async (articleContent: string, articleTitle: string) => {
    if (!articleContent || !limits.hasJsonLdSchema) return;
    try {
      setSchemaGenerating(true);
      const { data, error } = await supabase.functions.invoke("generate-schema", {
        body: {
          title: articleTitle,
          content: articleContent,
          keyword: selectedKeyword?.seed_keyword,
          questions: selectedKeyword?.questions || [],
        },
      });
      if (error || data?.error) return;
      const schemas = [];
      if (data.article_schema) schemas.push(data.article_schema);
      if (data.faq_schema) schemas.push(data.faq_schema);
      setSchemaJson(JSON.stringify(schemas, null, 2));
      if (data.faq_text_block) setFaqTextBlock(data.faq_text_block);
    } catch {
      // best-effort
    } finally {
      setSchemaGenerating(false);
    }
  }, [selectedKeyword, limits.hasJsonLdSchema]);

  // Auto-fill fields when keyword changes
  useEffect(() => {
    if (!selectedKeywordId) {
      setOutline([]);
      setTitle("");
      setMetaDescription("");
      return;
    }
    const kw = keywords.find((k: any) => k.id === selectedKeywordId);
    if (!kw) return;

    // Auto-fill title from seed keyword
    const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
    setTitle(capitalize(kw.seed_keyword));

    // Auto-fill meta description
    const intent = kw.intent || "informational";
    setMetaDescription(
      `${capitalize(kw.seed_keyword)} — ${intent === "informational" ? "полное руководство" : intent === "transactional" ? "лучшие предложения" : intent === "commercial" ? "сравнение и обзор" : "всё что нужно знать"}. ${(kw.lsi_keywords as string[] || []).slice(0, 3).join(", ")}.`.slice(0, 160)
    );

    // Auto-fill outline from questions
    if (kw.questions) {
      const items = (kw.questions as string[]).map((q: string) => ({ text: q, level: "h2" }));
      setOutline(items);
    }
  }, [selectedKeywordId]);

  return (
    <div className="space-y-6">
      {/* Mode Switcher */}
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">AI Writer</h1>
          <p className="text-sm text-muted-foreground">
            Генератор SEO-контента с динамическим выбором модели
          </p>
        </div>
        <div className="ml-auto flex items-center gap-1 rounded-lg border border-border bg-muted/50 p-1">
          <Button
            variant={mode === "single" ? "default" : "ghost"}
            size="sm"
            onClick={() => setMode("single")}
            className="gap-1.5 text-xs"
          >
            <Gem className="h-3.5 w-3.5" />
            Boutique
          </Button>
          <Button
            variant={mode === "bulk" ? "default" : "ghost"}
            size="sm"
            onClick={() => {
              if (!limits.hasBulkMode) {
                toast.error("Factory Mode доступен только на тарифе PRO");
                return;
              }
              setMode("bulk");
            }}
            className="gap-1.5 text-xs"
          >
            <Factory className="h-3.5 w-3.5" />
            Factory
            {!limits.hasBulkMode && <Badge variant="outline" className="text-[10px] px-1 py-0 ml-1">PRO</Badge>}
          </Button>
        </div>
      </div>

      {mode === "bulk" ? (
        <BulkGenerationMode />
      ) : (
      <>
      {/* Configuration */}
      <div className="rounded-lg border border-border bg-card p-4">
        <div className="grid gap-4 sm:grid-cols-[1fr_1fr_auto]">
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">Ключевое слово</Label>
            <Select value={selectedKeywordId} onValueChange={setSelectedKeywordId}>
              <SelectTrigger>
                <SelectValue placeholder="Выберите..." />
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
            <Label className="text-xs text-muted-foreground">Профиль автора</Label>
            <Select value={selectedAuthorId} onValueChange={setSelectedAuthorId}>
              <SelectTrigger>
                <SelectValue placeholder="Без стиля" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="none">Без стиля</SelectItem>
                {authorProfiles.map((a: any) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name} {a.niche ? `(${a.niche})` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label className="text-xs text-muted-foreground">&nbsp;</Label>
            {isStreaming ? (
              <Button variant="destructive" onClick={handleStop} className="w-full">
                Остановить
              </Button>
            ) : (
              <Button
                onClick={handleGenerate}
                disabled={!selectedKeywordId}
                className="w-full gap-2"
              >
                <Wand2 className="h-4 w-4" />
                Generate
              </Button>
            )}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1fr_320px]">
        {/* Left: Editor */}
        <div className="space-y-4">
          {/* Pro Image Cover Generator */}
          <ProImageGenerator
            title={title}
            content={content}
            keyword={selectedKeyword?.seed_keyword}
            onImageGenerated={(url, alt, markdown) => {
              // Prepend cover image to content
              setContent(prev => `![${alt}](${url})\n\n${prev}`);
            }}
            onMultiImagesGenerated={(images) => {
              // Insert images after their corresponding H2 headings
              setContent(prev => {
                let result = prev;
                // Process in reverse order to preserve line positions
                for (let i = images.length - 1; i >= 0; i--) {
                  const img = images[i];
                  const headingPattern = new RegExp(
                    `(^##\\s+${img.heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$)`,
                    'm'
                  );
                  const match = result.match(headingPattern);
                  if (match && match.index !== undefined) {
                    const insertPos = match.index + match[0].length;
                    const markdown = `\n\n![${img.alt}](${img.url})\n`;
                    result = result.slice(0, insertPos) + markdown + result.slice(insertPos);
                  }
                }
                return result;
              });
            }}
          />

          {/* Title & Meta */}
          <Card className="bg-card border-border">
            <CardContent className="pt-4 space-y-3">
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">Title (SEO-заголовок страницы)</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="SEO Title (до 60 символов)..."
                  maxLength={70}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">H1 (заголовок на странице)</Label>
                <Input
                  value={h1}
                  onChange={(e) => setH1(e.target.value)}
                  placeholder="Заголовок H1 статьи..."
                  className="text-lg font-semibold"
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">
                  Meta Description
                  <span className="ml-2 text-muted-foreground/60">
                    ({metaDescription.length}/160)
                  </span>
                </Label>
                <Input
                  value={metaDescription}
                  onChange={(e) => setMetaDescription(e.target.value)}
                  placeholder="SEO описание страницы..."
                  maxLength={160}
                />
              </div>
            </CardContent>
          </Card>

          {/* Content Editor / Preview */}
          <Card className="bg-card border-border">
            <Tabs defaultValue="edit">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center justify-between">
                  <TabsList className="h-8">
                    <TabsTrigger value="edit" className="text-xs gap-1.5 px-3">
                      <Pencil className="h-3 w-3" />
                      Редактор
                    </TabsTrigger>
                    <TabsTrigger value="preview" className="text-xs gap-1.5 px-3">
                      <Eye className="h-3 w-3" />
                      Предпросмотр
                    </TabsTrigger>
                    <TabsTrigger value="html" className="text-xs gap-1.5 px-3">
                      <Code2 className="h-3 w-3" />
                      HTML
                    </TabsTrigger>
                  </TabsList>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!content}
                      onClick={() => {
                        const html = markdownToFullHtml(content, title, metaDescription);
                        const blob = new Blob([html], { type: "text/html;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${(title || "article").replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]/g, "_")}.html`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success("HTML файл скачан");
                      }}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      HTML
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => saveArticle.mutate()}
                      disabled={!content || saveArticle.isPending}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      {saveArticle.isPending ? "..." : "Сохранить"}
                    </Button>
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isStreaming && (
                  <div className="flex items-center gap-2 mb-3 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>Генерация текста...</span>
                  </div>
                )}
                <TabsContent value="edit" className="mt-0">
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder="Нажмите Generate для создания контента или введите текст вручную..."
                    className="min-h-[500px] font-mono text-sm leading-relaxed resize-y"
                  />
                </TabsContent>
                <TabsContent value="preview" className="mt-0">
                  {content ? (
                    <div className="space-y-0">
                      {/* Author block */}
                      {selectedAuthorId && selectedAuthorId !== "none" && (() => {
                        const author = authorProfiles.find((a: any) => a.id === selectedAuthorId);
                        if (!author) return null;
                        return (
                          <div className="flex items-center gap-3 p-4 mb-6 rounded-lg bg-muted/50 border border-border">
                            <div className="flex items-center justify-center h-10 w-10 rounded-full bg-primary/10 text-primary">
                              <User className="h-5 w-5" />
                            </div>
                            <div>
                              <p className="text-sm font-semibold">{author.name}</p>
                              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                                {author.niche && <span>{author.niche}</span>}
                                {author.voice_tone && (
                                  <>
                                    <span>•</span>
                                    <span>{author.voice_tone}</span>
                                  </>
                                )}
                              </div>
                            </div>
                          </div>
                        );
                      })()}
                      <div
                        className="article-preview prose prose-sm max-w-none"
                        dangerouslySetInnerHTML={{ __html: markdownToPreviewHtml(content) }}
                      />
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm py-12 text-center">
                      Нет контента для предпросмотра
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="html" className="mt-0">
                  {content ? (
                    <div className="relative">
                      <div className="flex items-center gap-2 absolute top-2 right-2 z-10">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => {
                            navigator.clipboard.writeText(markdownToCleanHtml(content));
                            toast.success("Чистый HTML скопирован — вставляйте в любую CMS");
                          }}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          Копировать для CMS
                        </Button>
                      </div>
                      <pre className="min-h-[500px] max-h-[700px] overflow-auto p-4 rounded-md bg-muted text-xs font-mono whitespace-pre-wrap break-all text-foreground">
                        <code dangerouslySetInnerHTML={{ __html: highlightHtml(markdownToCleanHtml(content)) }} />
                      </pre>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm py-12 text-center">
                      Нет контента для просмотра HTML
                    </p>
                  )}
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

        </div>

        {/* Right: SEO Dashboard */}
        <div className="space-y-4">
          <Tabs defaultValue="dashboard">
            <TabsList className="w-full h-8">
              <TabsTrigger value="dashboard" className="text-xs gap-1 flex-1">
                <BarChart3 className="h-3 w-3" />
                Dashboard
              </TabsTrigger>
              <TabsTrigger value="human" className="text-xs gap-1 flex-1">
                <Shield className="h-3 w-3" />
                Human Score
              </TabsTrigger>
              <TabsTrigger value="benchmark" className="text-xs gap-1 flex-1">
                <Target className="h-3 w-3" />
                Benchmark
              </TabsTrigger>
            </TabsList>

            <TabsContent value="dashboard" className="mt-3 space-y-4">
              {/* Word count & readability */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    SEO Dashboard
                  </CardTitle>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Слова</span>
                      <span className="font-mono">{wordCount.toLocaleString()}</span>
                    </div>
                    <Progress
                      value={Math.min(100, (wordCount / 2000) * 100)}
                      className="h-2"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">Рекомендовано: 1500-2500</p>
                  </div>

                  <Separator />

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>Читаемость</span>
                      <span className={`font-semibold ${readInfo.color}`}>
                        {readability} — {readInfo.label}
                      </span>
                    </div>
                    <Progress value={readability} className="h-2" />
                    <p className="text-[10px] text-muted-foreground mt-1">Flesch Reading Ease</p>
                  </div>

                  <Separator />

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>LSI покрытие</span>
                      <span className="font-mono">
                        {lsiFoundCount}/{lsiKeywords.length}
                      </span>
                    </div>
                    <Progress
                      value={lsiKeywords.length > 0 ? (lsiFoundCount / lsiKeywords.length) * 100 : 0}
                      className="h-2"
                    />
                  </div>
                </CardContent>
              </Card>

              {/* LSI Keywords */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <Hash className="h-4 w-4 text-primary" />
                    LSI-ключевые слова
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {lsiStatus.length > 0 ? (
                    <div className="space-y-1.5 max-h-[400px] overflow-y-auto">
                      {lsiStatus.map((item, i) => (
                        <div
                          key={i}
                          className={`flex items-center gap-2 text-xs rounded-md px-2 py-1.5 transition-colors ${
                            item.found
                              ? "bg-success/10 text-success"
                              : "bg-muted/50 text-muted-foreground"
                          }`}
                        >
                          {item.found ? (
                            <CheckCircle2 className="h-3 w-3 shrink-0" />
                          ) : (
                            <Circle className="h-3 w-3 shrink-0" />
                          )}
                          <span className="font-mono">{item.keyword}</span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      Выберите ключевое слово для отображения LSI
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Saved Articles */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    Сохранённые статьи
                    <Badge variant="secondary" className="ml-auto text-[10px]">
                      {savedArticles.length}
                    </Badge>
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  {savedArticles.length > 0 ? (
                    <div className="space-y-1.5 max-h-[200px] overflow-y-auto">
                      {savedArticles.slice(0, 10).map((a: any) => (
                        <div
                          key={a.id}
                          className="flex items-center gap-1 group"
                        >
                        <button
                          className="flex-1 text-left text-xs rounded-md px-2 py-1.5 bg-muted/50 hover:bg-muted/80 transition-colors truncate"
                          onClick={async () => {
                            const { data } = await supabase
                              .from("articles")
                              .select("*")
                              .eq("id", a.id)
                              .single();
                            if (data) {
                              setCurrentArticleId(data.id);
                              setTitle(data.title || "");
                              setContent(data.content || "");
                              setMetaDescription(data.meta_description || "");
                              if (data.keyword_id) setSelectedKeywordId(data.keyword_id);
                              if (data.author_profile_id) setSelectedAuthorId(data.author_profile_id);
                            }
                          }}
                        >
                          <span className="font-medium">{a.title || "Без названия"}</span>
                          <span className="text-muted-foreground ml-1">({a.status})</span>
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                          title="Удалить статью"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const { error } = await supabase.functions.invoke("delete-content", { body: { type: "article", id: a.id } });
                            if (error) { console.error("Delete error:", error); toast.error("Ошибка удаления: " + error.message); return; }
                            queryClient.invalidateQueries({ queryKey: ["articles-list"] });
                            if (currentArticleId === a.id) {
                              setCurrentArticleId(null);
                              setTitle("");
                              setContent("");
                              setMetaDescription("");
                            }
                            toast.success("Статья удалена");
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">
                      Нет сохранённых статей
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="human" className="mt-3">
              <HumanScorePanel content={content} lsiKeywords={lsiKeywords} />
            </TabsContent>

            <TabsContent value="benchmark" className="mt-3">
              {selectedKeywordId ? (
                <SeoBenchmark
                  keywordId={selectedKeywordId}
                  content={content}
                  title={title}
                  metaDescription={metaDescription}
                  onOptimize={async ({ instructions, benchmarkContext }) => {
                    if (isStreaming) return;
                    setIsStreaming(true);
                    const prevContent = content;
                    setContent("");
                    const controller = new AbortController();
                    abortRef.current = controller;
                    try {
                      const { data: { session: freshSession }, error: refreshError } = await supabase.auth.refreshSession();
                      const token = freshSession?.access_token;
                      if (refreshError || !token) throw new Error("Not authenticated");

                      const url = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-article`;
                      const resp = await fetch(url, {
                        method: "POST",
                        headers: {
                          "Content-Type": "application/json",
                          Authorization: `Bearer ${token}`,
                          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
                        },
                        body: JSON.stringify({
                          keyword_id: selectedKeywordId,
                          author_profile_id: selectedAuthorId || null,
                          outline,
                          lsi_keywords: lsiKeywords,
                          optimize_instructions: instructions,
                          deep_analysis_context: benchmarkContext,
                          existing_content: prevContent,
                        }),
                        signal: controller.signal,
                      });

                      if (!resp.ok) {
                        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
                        throw new Error(err.error || `HTTP ${resp.status}`);
                      }
                      if (!resp.body) throw new Error("No stream body");

                      const reader = resp.body.getReader();
                      const decoder = new TextDecoder();
                      let buffer = "";
                      let fullContent = "";

                      while (true) {
                        const { done, value } = await reader.read();
                        if (done) break;
                        buffer += decoder.decode(value, { stream: true });
                        let ni: number;
                        while ((ni = buffer.indexOf("\n")) !== -1) {
                          let line = buffer.slice(0, ni);
                          buffer = buffer.slice(ni + 1);
                          if (line.endsWith("\r")) line = line.slice(0, -1);
                          if (line.startsWith(":") || line.trim() === "") continue;
                          if (!line.startsWith("data: ")) continue;
                          const jsonStr = line.slice(6).trim();
                          if (jsonStr === "[DONE]") break;
                          try {
                            const parsed = JSON.parse(jsonStr);
                            const delta = parsed.choices?.[0]?.delta?.content;
                            if (delta) { fullContent += delta; setContent(fullContent); }
                          } catch { buffer = line + "\n" + buffer; break; }
                        }
                      }

                      // Auto-generate SEO Title via AI
                      generateSeoTitle(fullContent);
                      toast.success("Статья оптимизирована по бенчмарку ТОП-10");
                    } catch (e: any) {
                      if (e.name === "AbortError") { toast.info("Генерация остановлена"); }
                      else { toast.error(e.message); setContent(prevContent); }
                    } finally {
                      setIsStreaming(false);
                      abortRef.current = null;
                    }
                  }}
                />
              ) : (
                <Card className="bg-card border-border">
                  <CardContent className="py-8 text-center">
                    <p className="text-sm text-muted-foreground">
                      Выберите ключевое слово для сравнения с конкурентами
                    </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>
          </Tabs>
        </div>
      </div>
      </>
      )}
    </div>
  );
}
