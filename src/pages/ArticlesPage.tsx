import { useState, useEffect, useMemo, useCallback, useRef } from "react";
import DOMPurify from "dompurify";
import { useSearchParams, useNavigate } from "react-router-dom";
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
  CheckCircle2, Circle, BarChart3, BookOpen, Copy, Check, Download, Eye, Pencil, User, Target, Factory, Gem, Shield, CreditCard, AlertTriangle, Send, Link2
} from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { toast } from "sonner";
import { useI18n } from "@/shared/hooks/useI18n";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";
import { SeoBenchmark } from "@/features/seo-analysis/SeoBenchmark";
import { BulkGenerationMode } from "@/components/bulk/BulkGenerationMode";
import { ProImageGenerator } from "@/features/pro-image-gen/ProImageGenerator";
import { HumanScorePanel } from "@/components/article/HumanScorePanel";
import { PersonaSelector } from "@/components/article/PersonaSelector";
import { MiralinksWidget, type MiralinksLink } from "@/components/article/MiralinksWidget";

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

function readabilityLabel(score: number, t: (k: string) => string): { label: string; color: string } {
  if (score >= 70) return { label: t("articles.readEasy"), color: "text-success" };
  if (score >= 50) return { label: t("articles.readMedium"), color: "text-warning" };
  return { label: t("articles.readHard"), color: "text-destructive" };
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
    .replace(/(&lt;!--[\s\S]*?--&gt;)/g, '<span class="html-comment">$1</span>')
    .replace(/(&lt;\/?)([\w-]+)/g, '<span class="html-tag">$1$2</span>')
    .replace(/\s([\w-]+)(=)/g, ' <span class="html-attr">$1</span>$2')
    .replace(/(&quot;)(.*?)(&quot;)/g, '<span class="html-val">$1$2$3</span>')
    .replace(/(&gt;)/g, '<span class="html-tag">$1</span>');
}

function markdownToCleanHtml(md: string): string {
  const lines = md.split("\n");
  const result: string[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Empty line
    if (!trimmed) {
      i++;
      continue;
    }

    // Table block
    if (trimmed.startsWith("|") && trimmed.endsWith("|")) {
      const tableRows: string[][] = [];
      while (i < lines.length && lines[i].trim().startsWith("|") && lines[i].trim().endsWith("|")) {
        const row = lines[i].trim();
        if (/^[\s|:-]+$/.test(row)) { i++; continue; }
        const cells = row.split("|").slice(1, -1).map(c => c.trim());
        tableRows.push(cells);
        i++;
      }
      if (tableRows.length > 0) {
        let table = '<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse;width:100%"><thead><tr>';
        tableRows[0].forEach(c => { table += `<th style="border:1px solid #ccc;padding:8px;background:#f5f5f5;text-align:left">${inlineMd(c)}</th>`; });
        table += "</tr></thead><tbody>";
        for (let r = 1; r < tableRows.length; r++) {
          table += "<tr>";
          tableRows[r].forEach(c => { table += `<td style="border:1px solid #ccc;padding:8px">${inlineMd(c)}</td>`; });
          table += "</tr>";
        }
        table += "</tbody></table>";
        result.push(table);
      }
      continue;
    }

    // Headings
    const headingMatch = trimmed.match(/^(#{1,6})\s+(.+)/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      result.push(`<h${level}>${inlineMd(headingMatch[2])}</h${level}>`);
      i++;
      continue;
    }

    // Unordered list
    if (/^[-*]\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*[-*]\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].trim().replace(/^[-*]\s+/, ""))}</li>`);
        i++;
      }
      result.push(`<ul>${items.join("")}</ul>`);
      continue;
    }

    // Ordered list
    if (/^\d+\.\s+/.test(trimmed)) {
      const items: string[] = [];
      while (i < lines.length && /^\s*\d+\.\s+/.test(lines[i])) {
        items.push(`<li>${inlineMd(lines[i].trim().replace(/^\d+\.\s+/, ""))}</li>`);
        i++;
      }
      result.push(`<ol>${items.join("")}</ol>`);
      continue;
    }

    // Blockquote
    if (trimmed.startsWith("> ")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith("> ")) {
        quoteLines.push(lines[i].trim().slice(2));
        i++;
      }
      result.push(`<blockquote style="border-left:3px solid #ccc;padding-left:12px;margin:12px 0;color:#555">${quoteLines.map(l => `<p>${inlineMd(l)}</p>`).join("")}</blockquote>`);
      continue;
    }

    // Horizontal rule
    if (/^[-*_]{3,}$/.test(trimmed)) {
      result.push("<hr>");
      i++;
      continue;
    }

    // Regular paragraph
    result.push(`<p>${inlineMd(trimmed)}</p>`);
    i++;
  }

  return result.join("\n");
}

function inlineMd(text: string): string {
  return text
    .replace(/\*\*\*(.+?)\*\*\*/g, "<strong><em>$1</em></strong>")
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`(.+?)`/g, "<code>$1</code>")
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img src="$2" alt="$1" style="max-width:100%;height:auto;" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
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
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const { limits } = usePlanLimits();
  const { t } = useI18n();
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
      toast.info(t("articles.articleLoaded"));
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
  const [streamPhase, setStreamPhase] = useState<"thinking" | "writing" | null>(null);
  const [streamElapsed, setStreamElapsed] = useState(0);
  const [schemaJson, setSchemaJson] = useState<string>("");
  const [schemaCopied, setSchemaCopied] = useState(false);
  const [faqTextBlock, setFaqTextBlock] = useState<string>("");
  const [faqCopied, setFaqCopied] = useState(false);
  const [schemaGenerating, setSchemaGenerating] = useState(false);
  const [faqMode, setFaqMode] = useState<"standard" | "serp-dominance">("serp-dominance");
  const [currentArticleId, setCurrentArticleId] = useState<string | null>(null);
  const [fixingIssue, setFixingIssue] = useState<string | null>(null);
  const [showCreditsModal, setShowCreditsModal] = useState(false);
  const [textCopied, setTextCopied] = useState(false);
  const [publishingTo, setPublishingTo] = useState<string | null>(null);
  const [miralinksLinks, setMiralinksLinks] = useState<MiralinksLink[]>([{ url: "", anchor: "" }]);
  const [miralinksFollowRules, setMiralinksFollowRules] = useState(true);
  const abortRef = useRef<AbortController | null>(null);

  // Timer for streaming elapsed seconds
  useEffect(() => {
    if (!isStreaming) { setStreamElapsed(0); return; }
    const start = Date.now();
    const interval = setInterval(() => setStreamElapsed(Math.floor((Date.now() - start) / 1000)), 1000);
    return () => clearInterval(interval);
  }, [isStreaming]);

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
      // Check if image generation is enabled
      if (localStorage.getItem("pro_image_enabled") !== "true") return;

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
  const readInfo = readabilityLabel(readability, t);

  // Stream article generation
  const handleGenerate = useCallback(async () => {
    if (!selectedKeywordId) {
      toast.error(t("articles.selectKeyword"));
      return;
    }

    setIsStreaming(true);
    setStreamPhase("thinking");
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
          author_profile_id: (selectedAuthorId && selectedAuthorId !== "none") ? selectedAuthorId : null,
          outline,
          lsi_keywords: lsiKeywords,
          competitor_tables: (selectedKeyword as any)?.competitor_tables || [],
          competitor_lists: (selectedKeyword as any)?.competitor_lists || [],
        }),
        signal: controller.signal,
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Unknown error" }));
        if (resp.status === 402) {
          setShowCreditsModal(true);
          setIsStreaming(false);
          setStreamPhase(null);
          return;
        }
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
              if (!fullContent) setStreamPhase("writing");
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

      // Sanitize: strip all HTML tags and inline styles from generated markdown
      fullContent = fullContent
        .replace(/<[^>]*style="[^"]*"[^>]*>/gi, "") // remove tags with style attr
        .replace(/<\/?(span|div|p|br|ul|ol|li|strong|em|a|h[1-6]|img|figure|figcaption|blockquote|code|pre|table|thead|tbody|tr|td|th|hr|sup|sub|del|ins|mark|small|b|i|u|s|abbr|cite|dfn|kbd|q|ruby|rt|rp|samp|var|wbr|details|summary|time|data|output|progress|meter|section|article|aside|header|footer|nav|main|dialog|template|slot)\b[^>]*>/gi, "")
        .replace(/<!\-\-[^]*?\-\->/g, (m) => m.includes("FAQ Schema") ? m : "") // keep FAQ comment only
        .replace(/style="[^"]*"/gi, "");

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

      toast.success(t("articles.articleGenerated"));

      // Auto-generate FAQ & JSON-LD schema (async, best-effort)
      autoGenerateSchema(fullContent, title);

      // Auto-generate and insert images (async, best-effort, PRO only)
      autoInsertImages(fullContent);
    } catch (e: any) {
      if (e.name === "AbortError") {
        toast.info(t("articles.genStopped"));
      } else {
        toast.error(e.message);
      }
    } finally {
      setIsStreaming(false);
      setStreamPhase(null);
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
        status: "published",
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
      toast.success(t("articles.articleSaved"));
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
          lsi_keywords: lsiKeywords,
          mode: faqMode,
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
          lsi_keywords: lsiKeywords,
          mode: faqMode,
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
  }, [selectedKeyword, limits.hasJsonLdSchema, faqMode, lsiKeywords]);

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
    <div className="space-y-6 overflow-x-hidden">
      {/* Mode Switcher */}
      <div className="flex items-center gap-3">
        <FileText className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("articles.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("articles.subtitle")}</p>
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
                toast.error("Factory Mode - PRO only");
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
            <Label className="text-xs text-muted-foreground">{t("articles.keyword")}</Label>
            <Select value={selectedKeywordId} onValueChange={setSelectedKeywordId}>
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
              <Button variant="destructive" onClick={handleStop} className="w-full">
                {t("articles.stop")}
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

        {/* Persona Selector */}
        <PersonaSelector
          authors={authorProfiles}
          selectedId={selectedAuthorId}
          onSelect={setSelectedAuthorId}
        />
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
                <Label className="text-xs text-muted-foreground">Title (SEO)</Label>
                <Input
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder={t("articles.titlePlaceholder")}
                  maxLength={70}
                />
              </div>
              <div className="space-y-1.5">
                <Label className="text-xs text-muted-foreground">{t("articles.h1Title")}</Label>
                <Input
                  value={h1}
                  onChange={(e) => setH1(e.target.value)}
                  placeholder={t("articles.h1Title")}
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
                  placeholder={t("articles.metaPlaceholder")}
                  maxLength={160}
                />
              </div>
            </CardContent>
          </Card>

          {/* Content Editor / Preview */}
          <Card className="bg-card border-border">
            <Tabs defaultValue="edit">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm">
                  <div className="flex items-center gap-3">
                  <TabsList className="h-8 shrink-0">
                    <TabsTrigger value="edit" className="text-xs gap-1 px-2.5">
                      <Pencil className="h-3 w-3" />
                      {t("articles.editor")}
                    </TabsTrigger>
                    <TabsTrigger value="preview" className="text-xs gap-1 px-2.5">
                      <Eye className="h-3 w-3" />
                      {t("articles.preview")}
                    </TabsTrigger>
                    <TabsTrigger value="html" className="text-xs gap-1 px-2.5">
                      <Code2 className="h-3 w-3" />
                      HTML
                    </TabsTrigger>
                    <TabsTrigger value="schema" className="text-xs gap-1 px-2.5">
                      <Code2 className="h-3 w-3" />
                      FAQ & Schema
                    </TabsTrigger>
                  </TabsList>
                  <Separator orientation="vertical" className="h-5" />
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!content}
                      onClick={async () => {
                        const html = markdownToCleanHtml(content);
                        try {
                          await navigator.clipboard.write([
                            new ClipboardItem({
                              "text/html": new Blob([html], { type: "text/html" }),
                              "text/plain": new Blob([content], { type: "text/plain" }),
                            }),
                          ]);
                        } catch {
                          await navigator.clipboard.writeText(content);
                        }
                        setTextCopied(true);
                        toast.success(t("common.copied"));
                        setTimeout(() => setTextCopied(false), 2000);
                      }}
                    >
                      {textCopied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                      {textCopied ? t("common.copied") : t("common.copy")}
                    </Button>
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
                        toast.success(t("articles.htmlDownloaded"));
                      }}
                    >
                      <Download className="h-3 w-3 mr-1" />
                      HTML
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={!content}
                      onClick={() => {
                        const html = markdownToCleanHtml(content);
                        const fullHtml = `<html><head><meta charset="utf-8"><title>${title || "Article"}</title></head><body>${html}</body></html>`;
                        const blob = new Blob(['\ufeff', fullHtml], { type: "application/msword;charset=utf-8" });
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement("a");
                        a.href = url;
                        a.download = `${(title || "article").replace(/[^a-zA-Zа-яА-ЯёЁ0-9_-]/g, "_")}.doc`;
                        a.click();
                        URL.revokeObjectURL(url);
                        toast.success("Файл .doc скачан — откройте в Google Docs");
                      }}
                    >
                      <FileText className="h-3 w-3 mr-1" />
                      Google Docs
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => saveArticle.mutate()}
                      disabled={!content || saveArticle.isPending}
                    >
                      <Save className="h-3 w-3 mr-1" />
                      {saveArticle.isPending ? "..." : t("common.save")}
                    </Button>

                    {/* Blog platform publish buttons — PRO only */}
                    {currentArticleId && content && limits.hasProImageGen && (
                      <>
                        <Separator orientation="vertical" className="h-5" />
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={publishingTo !== null}
                          onClick={async () => {
                            setPublishingTo("telegraph");
                            try {
                              const { data, error } = await supabase.functions.invoke("publish-telegraph", {
                                body: { article_id: currentArticleId, author_name: authorProfiles.find((a: any) => a.id === selectedAuthorId)?.name || "Author" },
                              });
                              if (error || !data?.success) throw new Error(data?.error || "Ошибка публикации");
                              toast.success("Опубликовано в Telegra.ph!", { description: data.url, action: { label: "Открыть", onClick: () => window.open(data.url, "_blank") } });
                            } catch (e: any) {
                              toast.error(e.message || "Ошибка Telegra.ph");
                            } finally {
                              setPublishingTo(null);
                            }
                          }}
                        >
                          {publishingTo === "telegraph" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                          Telegra.ph
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={publishingTo !== null}
                          onClick={async () => {
                            setPublishingTo("ghost");
                            try {
                              const { data, error } = await supabase.functions.invoke("publish-ghost", {
                                body: { article_id: currentArticleId },
                              });
                              if (error || !data?.success) throw new Error(data?.error || "Ошибка публикации");
                              toast.success("Черновик создан в Ghost!", { description: data.url, action: { label: "Открыть", onClick: () => window.open(data.url, "_blank") } });
                            } catch (e: any) {
                              toast.error(e.message || "Ошибка Ghost");
                            } finally {
                              setPublishingTo(null);
                            }
                          }}
                        >
                          {publishingTo === "ghost" ? <Loader2 className="h-3 w-3 mr-1 animate-spin" /> : <Send className="h-3 w-3 mr-1" />}
                          Ghost
                        </Button>
                      </>
                    )}
                  </div>
                </CardTitle>
              </CardHeader>
              <CardContent>
                {isStreaming && (
                  <div className="flex items-center gap-2 mb-3 text-sm text-primary">
                    <Loader2 className="h-4 w-4 animate-spin" />
                    <span>
                      {streamPhase === "thinking"
                        ? `${t("articles.generating")} ${streamElapsed}s`
                        : `${t("articles.generating")} ${streamElapsed}s`}
                    </span>
                  </div>
                )}
                <TabsContent value="edit" className="mt-0">
                  <Textarea
                    value={content}
                    onChange={(e) => setContent(e.target.value)}
                    placeholder={t("articles.editorPlaceholder")}
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
                                {author.description && <span>{author.description}</span>}
                                {!author.description && author.niche && <span>{author.niche}</span>}
                                {!author.description && author.voice_tone && (
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
                        dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(markdownToPreviewHtml(content)) }}
                      />
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm py-12 text-center">
                      {t("articles.noContent")}
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
                            toast.success(t("common.copied"));
                          }}
                        >
                          <Copy className="h-3 w-3 mr-1" />
                          {t("common.copy")} HTML
                        </Button>
                      </div>
                      <pre className="min-h-[500px] max-h-[700px] overflow-auto p-4 rounded-md bg-muted text-xs font-mono whitespace-pre-wrap break-all text-foreground">
                        <code dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlightHtml(markdownToCleanHtml(content))) }} />
                      </pre>
                    </div>
                  ) : (
                    <p className="text-muted-foreground text-sm py-12 text-center">
                      {t("articles.noContent")}
                    </p>
                  )}
                </TabsContent>
                <TabsContent value="schema" className="mt-0">
                  <div className="space-y-4">
                    {/* Mode Toggle */}
                    <div className="flex items-center justify-between rounded-lg border border-border bg-muted/30 p-3">
                      <div className="flex items-center gap-3">
                        <div className="flex rounded-lg border border-border bg-background p-0.5">
                          <button
                            onClick={() => setFaqMode("standard")}
                            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                              faqMode === "standard"
                                ? "bg-primary text-primary-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            Standard FAQ
                          </button>
                          <button
                            onClick={() => setFaqMode("serp-dominance")}
                            className={`px-3 py-1.5 text-xs rounded-md transition-colors ${
                              faqMode === "serp-dominance"
                                ? "bg-primary text-primary-foreground font-medium"
                                : "text-muted-foreground hover:text-foreground"
                            }`}
                          >
                            🚀 SERP-Dominance
                          </button>
                        </div>
                        <span className="text-[10px] text-muted-foreground">
                          {faqMode === "serp-dominance"
                            ? "Information Gain + SGE-Ready + Entity Injection"
                            : "Стандартные FAQ вопросы и ответы"}
                        </span>
                      </div>
                      <Button
                        size="sm"
                        onClick={() => generateSchema.mutate()}
                        disabled={!content || generateSchema.isPending || schemaGenerating}
                        className="gap-1.5"
                      >
                        {(generateSchema.isPending || schemaGenerating) ? (
                          <Loader2 className="h-3 w-3 animate-spin" />
                        ) : (
                          <Wand2 className="h-3 w-3" />
                        )}
                        {(generateSchema.isPending || schemaGenerating) ? t("common.loading") : "Generate FAQ"}
                      </Button>
                    </div>

                    {/* FAQ Text Block */}
                    {faqTextBlock && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold flex items-center gap-2">
                            <BookOpen className="h-4 w-4 text-primary" />
                            FAQ — Визуальный блок
                            {faqMode === "serp-dominance" && (
                              <Badge variant="secondary" className="text-[10px]">Information Gain</Badge>
                            )}
                          </h4>
                          <div className="flex gap-1.5">
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => copyToClipboard(faqTextBlock, "faq")}
                            >
                              {faqCopied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                              {faqCopied ? t("common.copied") : t("common.copy")}
                            </Button>
                          </div>
                        </div>
                        <div
                          className="rounded-lg border border-border bg-background p-4 prose prose-sm max-w-none"
                          dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(markdownToPreviewHtml(faqTextBlock)) }}
                        />
                      </div>
                    )}

                    {/* JSON-LD Schema Code */}
                    {schemaJson && (
                      <div className="space-y-2">
                        <div className="flex items-center justify-between">
                          <h4 className="text-sm font-semibold flex items-center gap-2">
                            <Code2 className="h-4 w-4 text-primary" />
                            JSON-LD Schema 3.0
                            <Badge variant="outline" className="text-[10px]">Schema.org</Badge>
                          </h4>
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => copyToClipboard(schemaJson, "schema")}
                          >
                            {schemaCopied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                            {schemaCopied ? t("common.copied") : `${t("common.copy")} <script>`}
                          </Button>
                        </div>
                        <pre className="rounded-lg border border-border bg-muted p-4 text-xs font-mono whitespace-pre-wrap break-all max-h-[400px] overflow-auto text-foreground">
                          <code dangerouslySetInnerHTML={{ __html: DOMPurify.sanitize(highlightHtml(`<script type="application/ld+json">\n${schemaJson}\n</script>`)) }} />
                        </pre>
                      </div>
                    )}

                    {/* Empty state */}
                    {!faqTextBlock && !schemaJson && !generateSchema.isPending && !schemaGenerating && (
                      <div className="py-12 text-center">
                        <Code2 className="h-8 w-8 mx-auto text-muted-foreground/50 mb-3" />
                        <p className="text-sm text-muted-foreground">
                          Click "Generate FAQ" to create a Q&A block with JSON-LD schema markup
                        </p>
                        {faqMode === "serp-dominance" && (
                          <p className="text-xs text-muted-foreground/70 mt-2">
                            Режим SERP-Dominance: Information Gain + Dynamic Entity Injection + SGE-Ready formatting
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                </TabsContent>
              </CardContent>
            </Tabs>
          </Card>

        </div>

        {/* Right: SEO Dashboard */}
        <div className="space-y-4 lg:sticky lg:top-4 lg:self-start lg:max-h-[calc(100vh-2rem)] lg:overflow-auto">
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
              <TabsTrigger value="miralinks" className="text-xs gap-1 flex-1">
                <Link2 className="h-3 w-3" />
                Miralinks
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
                      <span>{t("articles.wordsLabel")}</span>
                      <span className="font-mono">{wordCount.toLocaleString()}</span>
                    </div>
                    <Progress
                      value={Math.min(100, (wordCount / 2000) * 100)}
                      className="h-2"
                    />
                    <p className="text-[10px] text-muted-foreground mt-1">{t("articles.recommended")}</p>
                  </div>

                  <Separator />

                  <div>
                    <div className="flex justify-between text-xs text-muted-foreground mb-1">
                      <span>{t("articles.readability")}</span>
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
                      <span>{t("articles.lsiCoverage")}</span>
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
                    {t("articles.lsiKeywords")}
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
                       {t("articles.selectForLsi")}
                    </p>
                  )}
                </CardContent>
              </Card>

              {/* Saved Articles */}
              <Card className="bg-card border-border">
                <CardHeader className="pb-3">
                  <CardTitle className="text-sm flex items-center gap-2">
                    <FileText className="h-4 w-4" />
                    {t("articles.savedArticles")}
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
                          <span className="font-medium">{a.title || t("common.noTitle")}</span>
                          <span className="text-muted-foreground ml-1">({a.status})</span>
                        </button>
                        <button
                          className="opacity-0 group-hover:opacity-100 transition-opacity p-1 rounded hover:bg-destructive/10 text-muted-foreground hover:text-destructive shrink-0"
                          title="Удалить статью"
                          onClick={async (e) => {
                            e.stopPropagation();
                             const { error } = await supabase.functions.invoke("delete-content", { body: { type: "article", id: a.id } });
                             if (error) { console.error("Delete error:", error); toast.error(error.message); return; }
                            queryClient.invalidateQueries({ queryKey: ["articles-list"] });
                            if (currentArticleId === a.id) {
                              setCurrentArticleId(null);
                              setTitle("");
                              setContent("");
                              setMetaDescription("");
                            }
                            toast.success(t("common.delete"));
                          }}
                        >
                          <Trash2 className="h-3 w-3" />
                        </button>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-xs text-muted-foreground text-center py-2">
                       {t("articles.noSaved")}
                    </p>
                  )}
                </CardContent>
              </Card>
            </TabsContent>

            <TabsContent value="human" className="mt-3">
              <HumanScorePanel
                content={content}
                lsiKeywords={lsiKeywords}
                isFixing={fixingIssue}
                onFixIssue={async (issueKey, instruction) => {
                  if (!selectedKeywordId || !content.trim()) {
                    toast.error("No content to fix");
                    return;
                  }
                  setFixingIssue(issueKey);
                  setIsStreaming(true);
                  setStreamPhase("thinking");
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
                        author_profile_id: (selectedAuthorId && selectedAuthorId !== "none") ? selectedAuthorId : null,
                        outline,
                        lsi_keywords: lsiKeywords,
                        optimize_instructions: `ЗАДАЧА: Исправь ТОЛЬКО указанную проблему, сохрани весь остальной текст максимально близко к оригиналу.\n\n${instruction}\n\nВАЖНО: НЕ переписывай статью целиком. Измени только те части, которые нарушают указанное правило. Сохрани структуру, заголовки и объём.`,
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
                          if (delta) { if (!fullContent) setStreamPhase("writing"); fullContent += delta; setContent(fullContent); }
                        } catch { buffer = line + "\n" + buffer; break; }
                      }
                    }

                    toast.success("Issue fixed - check Human Score");
                  } catch (e: any) {
                     if (e.name === "AbortError") { toast.info(t("articles.genStopped")); }
                    else { toast.error(e.message); setContent(prevContent); }
                  } finally {
                    setIsStreaming(false);
                    setStreamPhase(null);
                    setFixingIssue(null);
                    abortRef.current = null;
                  }
                }}
              />
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
                    setStreamPhase("thinking");
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
                        author_profile_id: (selectedAuthorId && selectedAuthorId !== "none") ? selectedAuthorId : null,
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
                            if (delta) { if (!fullContent) setStreamPhase("writing"); fullContent += delta; setContent(fullContent); }
                          } catch { buffer = line + "\n" + buffer; break; }
                        }
                      }

                      // Auto-generate SEO Title via AI
                      generateSeoTitle(fullContent);
                      toast.success("Article optimized against TOP-10 benchmark");
                    } catch (e: any) {
                      if (e.name === "AbortError") { toast.info(t("articles.genStopped")); }
                      else { toast.error(e.message); setContent(prevContent); }
                    } finally {
                      setIsStreaming(false);
                      setStreamPhase(null);
                      abortRef.current = null;
                    }
                  }}
                />
              ) : (
                <Card className="bg-card border-border">
                  <CardContent className="py-8 text-center">
                     <p className="text-sm text-muted-foreground">
                       {t("articles.selectKeyword")}
                     </p>
                  </CardContent>
                </Card>
              )}
            </TabsContent>

            <TabsContent value="miralinks" className="mt-3">
              <MiralinksWidget
                content={content}
                title={title}
                metaDescription={metaDescription}
              />
            </TabsContent>
          </Tabs>
        </div>
      </div>
      </>
      )}

      {/* Credits Modal */}
      <Dialog open={showCreditsModal} onOpenChange={setShowCreditsModal}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <div className="flex items-center gap-3 mb-2">
              <div className="h-12 w-12 rounded-full bg-destructive/10 flex items-center justify-center">
                <AlertTriangle className="h-6 w-6 text-destructive" />
              </div>
              <div>
                 <DialogTitle>{t("articles.noCreditsTitle") || "Not enough credits"}</DialogTitle>
                 <DialogDescription className="mt-1">
                   {t("articles.noCreditsDesc") || "You have run out of article generation credits"}
                 </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="space-y-4 pt-2">
            <div className="rounded-lg bg-muted/50 p-4 text-center">
              <p className="text-3xl font-bold text-destructive">0</p>
              <p className="text-xs text-muted-foreground mt-1">{t("pricing.credits")}</p>
            </div>
             <p className="text-sm text-muted-foreground">
               {t("pricing.creditNote")}
             </p>
            <div className="flex gap-2">
               <Button variant="outline" className="flex-1" onClick={() => setShowCreditsModal(false)}>
                 {t("common.close")}
              </Button>
              <Button className="flex-1" onClick={() => { setShowCreditsModal(false); navigate("/pricing"); }}>
                <CreditCard className="h-4 w-4 mr-1.5" />
                {t("nav.pricing")}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
