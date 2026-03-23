import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Crown, Copy, Check, X, Images } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { StylePresets, type ImageStyle } from "./StylePresets";

interface ProImageGeneratorProps {
  title: string;
  content: string;
  keyword?: string;
  onImageGenerated?: (url: string, alt: string, markdown: string) => void;
  onMultiImagesGenerated?: (images: { heading: string; url: string; alt: string }[]) => void;
}

export function ProImageGenerator({ title, content, keyword, onImageGenerated, onMultiImagesGenerated }: ProImageGeneratorProps) {
  const { isPro } = usePlanLimits();
  const [selectedStyle, setSelectedStyle] = useState<ImageStyle>("modern-tech");
  const [isGenerating, setIsGenerating] = useState(false);
  const [isGeneratingMulti, setIsGeneratingMulti] = useState(false);
  const [generatedImage, setGeneratedImage] = useState<{
    url: string;
    alt: string;
    filename: string;
    remaining: number;
  } | null>(null);
  const [copied, setCopied] = useState(false);

  if (!isPro) {
    return (
      <Card className="border-dashed border-purple-500/30 bg-card">
        <CardContent className="flex flex-col items-center justify-center py-8 text-center space-y-3">
          <div className="h-12 w-12 rounded-full bg-purple-500/10 flex items-center justify-center">
            <Crown className="h-5 w-5 text-purple-400" />
          </div>
          <div>
            <p className="font-medium text-foreground">Pro Visual Synthesis</p>
            <p className="text-sm text-muted-foreground mt-1">
              Генерация AI-обложек доступна на тарифе <span className="font-semibold text-purple-400">PRO</span>
            </p>
          </div>
          <Badge variant="outline" className="border-purple-500/30 text-purple-400">
            <Crown className="h-3 w-3 mr-1" /> PRO
          </Badge>
        </CardContent>
      </Card>
    );
  }

  const getAuthToken = async () => {
    const { data: { session } } = await supabase.auth.getSession();
    const token = session?.access_token;
    if (!token) throw new Error("Не авторизован");
    return token;
  };

  const handleGenerate = async () => {
    if (!title) {
      toast.error("Заполните заголовок статьи");
      return;
    }

    setIsGenerating(true);
    setGeneratedImage(null);

    try {
      const token = await getAuthToken();

      const summary = content
        ?.replace(/^#.+$/gm, "")
        .split(/\n\n+/)
        .map(p => p.trim())
        .filter(p => p.length > 20)
        .slice(0, 2)
        .join(" ")
        .slice(0, 300) || title;

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-pro-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          title,
          summary,
          style: selectedStyle,
          keyword: keyword || title,
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Ошибка генерации" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      setGeneratedImage(data);
      toast.success(`Изображение сгенерировано! Осталось: ${data.remaining}`);

      if (onImageGenerated) {
        const markdown = `![${data.alt}](${data.url})`;
        onImageGenerated(data.url, data.alt, markdown);
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsGenerating(false);
    }
  };

  const handleGenerateMulti = async () => {
    if (!title || !content) {
      toast.error("Нужна статья с H2-секциями");
      return;
    }

    // Quick check for H2 sections
    const h2Count = (content.match(/^##\s+/gm) || []).length;
    if (h2Count === 0) {
      toast.error("В статье не найдены H2-заголовки (## ...)");
      return;
    }

    setIsGeneratingMulti(true);
    try {
      const token = await getAuthToken();

      const resp = await fetch(`${import.meta.env.VITE_SUPABASE_URL}/functions/v1/generate-pro-image`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${token}`,
          apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
        },
        body: JSON.stringify({
          title,
          content,
          style: selectedStyle,
          keyword: keyword || title,
          mode: "multi",
        }),
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({ error: "Ошибка генерации" }));
        throw new Error(err.error || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      const { images, remaining } = data;

      if (images?.length > 0) {
        toast.success(`Сгенерировано ${images.length} иллюстраций! Осталось: ${remaining}`);
        onMultiImagesGenerated?.(images);
      } else {
        toast.warning("Не удалось сгенерировать изображения");
      }
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setIsGeneratingMulti(false);
    }
  };

  const copyMarkdown = () => {
    if (!generatedImage) return;
    navigator.clipboard.writeText(`![${generatedImage.alt}](${generatedImage.url})`);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
    toast.success("Markdown скопирован");
  };

  const isAnyGenerating = isGenerating || isGeneratingMulti;

  return (
    <div className="space-y-3">
      <AnimatePresence mode="wait">
        {isAnyGenerating ? (
          <motion.div
            key="skeleton"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            className="relative overflow-hidden rounded-xl border border-purple-500/30"
          >
            <div className="h-48 bg-gradient-to-br from-purple-950/80 via-card to-purple-900/40 flex flex-col items-center justify-center gap-3">
              <motion.div
                animate={{ rotate: 360 }}
                transition={{ duration: 3, repeat: Infinity, ease: "linear" }}
                className="p-3 rounded-full bg-purple-500/20"
              >
                <Sparkles className="w-6 h-6 text-purple-400" />
              </motion.div>
              <span className="text-sm text-purple-300 font-medium">
                {isGeneratingMulti ? "Генерируем иллюстрации для секций..." : "Синтезируем уникальный визуал..."}
              </span>
              <div className="w-48 h-1 rounded-full bg-purple-500/20 overflow-hidden">
                <motion.div
                  className="h-full bg-purple-500/60 rounded-full"
                  animate={{ x: ["-100%", "100%"] }}
                  transition={{ duration: 1.5, repeat: Infinity, ease: "easeInOut" }}
                  style={{ width: "50%" }}
                />
              </div>
            </div>
            <div className="absolute inset-0 pointer-events-none rounded-xl border border-purple-500/20 shadow-[0_0_15px_rgba(168,85,247,0.15)]" />
          </motion.div>
        ) : generatedImage ? (
          <motion.div
            key="result"
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            className="space-y-2"
          >
            <div className="relative group rounded-xl overflow-hidden border border-purple-500/30">
              <img
                src={generatedImage.url}
                alt={generatedImage.alt}
                className="w-full h-auto max-h-[300px] object-cover"
              />
              <div className="absolute top-2 right-2 flex gap-1.5">
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs bg-background/80 backdrop-blur-sm"
                  onClick={copyMarkdown}
                >
                  {copied ? <Check className="h-3 w-3 mr-1" /> : <Copy className="h-3 w-3 mr-1" />}
                  Markdown
                </Button>
                <Button
                  size="sm"
                  variant="secondary"
                  className="h-7 text-xs bg-background/80 backdrop-blur-sm"
                  onClick={() => setGeneratedImage(null)}
                >
                  <X className="h-3 w-3" />
                </Button>
              </div>
              <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-background/90 to-transparent p-3">
                <p className="text-xs text-muted-foreground truncate">
                  <span className="text-purple-400 font-medium">Alt:</span> {generatedImage.alt}
                </p>
                <p className="text-xs text-muted-foreground/60 mt-0.5">
                  {generatedImage.filename} · Осталось генераций: {generatedImage.remaining}
                </p>
              </div>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={handleGenerate}
              className="w-full border-purple-500/30 text-purple-400 hover:bg-purple-500/10"
            >
              <Sparkles className="h-3 w-3 mr-1.5" />
              Перегенерировать
            </Button>
          </motion.div>
        ) : (
          <motion.div
            key="buttons"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="space-y-2"
          >
            {/* Single cover image */}
            <div className="relative group overflow-hidden rounded-xl border border-purple-500/30 bg-card">
              <button
                onClick={handleGenerate}
                disabled={!title}
                className="w-full py-6 flex flex-col items-center justify-center gap-2 bg-purple-500/5 hover:bg-purple-500/10 transition-all disabled:opacity-50 disabled:cursor-not-allowed"
              >
                <div className="p-2.5 rounded-full bg-purple-500/20 text-purple-400 group-hover:scale-110 transition-transform">
                  <Sparkles className="w-5 h-5" />
                </div>
                <span className="text-foreground font-medium text-sm">Синтезировать Pro-обложку</span>
                <span className="text-[10px] text-purple-400/60 uppercase tracking-widest">
                  Powered by Flux AI
                </span>
              </button>
            </div>

            {/* Multi-image for sections */}
            {content && (content.match(/^##\s+/gm) || []).length > 0 && (
              <div className="relative group overflow-hidden rounded-xl border border-cyan-500/30 bg-card">
                <button
                  onClick={handleGenerateMulti}
                  className="w-full py-4 flex items-center justify-center gap-3 bg-cyan-500/5 hover:bg-cyan-500/10 transition-all"
                >
                  <div className="p-2 rounded-full bg-cyan-500/20 text-cyan-400">
                    <Images className="w-4 h-4" />
                  </div>
                  <div className="text-left">
                    <span className="text-foreground font-medium text-sm block">
                      Иллюстрации для секций
                    </span>
                    <span className="text-[10px] text-cyan-400/60">
                      {Math.min((content.match(/^##\s+/gm) || []).length, 5)} изображений между H2
                    </span>
                  </div>
                </button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      {/* Style Presets */}
      {!generatedImage && !isAnyGenerating && (
        <StylePresets selected={selectedStyle} onSelect={setSelectedStyle} />
      )}
    </div>
  );
}
