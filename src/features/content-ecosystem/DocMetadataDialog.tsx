import { useEffect, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Loader2, Sparkles } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

export interface DocMetadata {
  title?: string;
  subtitle?: string;
  category?: string;
  target_audience?: string;
  geo?: string;
  version?: string;
  author_name?: string;
  author_title?: string;
  author_bio?: string;
  author_experience?: string;
  contact_email?: string;
  contact_phone?: string;
  website_url?: string;
  cta_text?: string;
  source_note?: string;
  extra_instructions?: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  format: any | null;
  client: any | null;
  article?: any | null;
  onGenerated?: () => void;
}

const FIELDS: Array<{ key: keyof DocMetadata; label: string; placeholder?: string; multiline?: boolean; hint?: string }> = [
  { key: "title", label: "Заголовок документа", placeholder: "По умолчанию - название статьи" },
  { key: "subtitle", label: "Подзаголовок / польза", placeholder: "Что читатель получит из документа" },
  { key: "category", label: "Категория (chip на обложке)", placeholder: "Экспертный гайд" },
  { key: "target_audience", label: "Для кого документ", placeholder: "Маркетологи, владельцы e-commerce ...", multiline: true },
  { key: "geo", label: "География / рынок", placeholder: "Россия / EN / EU / глобально" },
  { key: "version", label: "Версия", placeholder: "1.0" },
  { key: "author_name", label: "Автор - имя", placeholder: "По умолчанию - эксперт клиента" },
  { key: "author_title", label: "Автор - должность", placeholder: "Head of SEO, 12 лет практики" },
  { key: "author_bio", label: "Автор - био", multiline: true, hint: "2-3 предложения об опыте и экспертизе" },
  { key: "author_experience", label: "Ключевой опыт / регалии", multiline: true, placeholder: "Кейсы, публикации, сертификаты" },
  { key: "contact_email", label: "Контактный email" },
  { key: "contact_phone", label: "Контактный телефон" },
  { key: "website_url", label: "Сайт / посадочная", placeholder: "https://..." },
  { key: "cta_text", label: "Текст CTA-кнопки", placeholder: "Получить консультацию" },
  { key: "source_note", label: "Блок Источник", multiline: true, placeholder: "На чем основан документ (методики, данные)" },
  { key: "extra_instructions", label: "Дополнительные указания генератору", multiline: true, hint: "Например: тональность, обязательные термины, чего избегать" },
];

export function DocMetadataDialog({ open, onOpenChange, format, client, article, onGenerated }: Props) {
  const [meta, setMeta] = useState<DocMetadata>({});
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!open || !format) return;
    const existing = (format?.metadata as DocMetadata | null) || {};
    // Auto-fill from article + client + document type. Explicit user edits (existing) win.
    const domain: string = client?.domain || "";
    const websiteUrl = domain ? (domain.startsWith("http") ? domain : `https://${domain}`) : "";
    const brand: string = client?.name || "";
    const docTypeName: string = format?.document_types?.name || "";
    const articleTitle: string = article?.title || "";
    const articleDesc: string = article?.meta_description || "";
    const brandVoice: string = client?.brand_voice || "";
    const clientDesc: string = client?.description || "";
    const lang: string = article?.language || "";
    const geoDefault = lang === "en" ? "Global / EN" : lang === "ru" ? "Россия / СНГ" : "";

    const autofill: DocMetadata = {
      title: articleTitle || undefined,
      subtitle: articleDesc || (docTypeName && brand ? `${docTypeName} от ${brand}` : undefined),
      category: docTypeName || undefined,
      target_audience: clientDesc || undefined,
      geo: geoDefault || undefined,
      version: "1.0",
      author_name: client?.expert_name || brand || undefined,
      author_title: client?.expert_name && brand ? `Эксперт ${brand}` : undefined,
      author_bio: client?.expert_bio || undefined,
      contact_email: client?.contact_email || undefined,
      contact_phone: client?.contact_phone || undefined,
      website_url: websiteUrl || undefined,
      cta_text: brand ? `Получить консультацию ${brand}` : "Получить консультацию",
      source_note: brand && client?.expert_name
        ? `Материал подготовлен экспертами ${brand} (${client.expert_name}) на основе практики агентства.`
        : brand
          ? `Материал подготовлен экспертами ${brand} на основе практики агентства.`
          : undefined,
      extra_instructions: brandVoice ? `Тональность бренда: ${brandVoice}` : undefined,
    };

    // Strip undefined so `existing` values overwrite cleanly.
    const clean: DocMetadata = {};
    for (const [k, v] of Object.entries(autofill)) {
      if (typeof v === "string" && v.trim()) (clean as any)[k] = v;
    }
    setMeta({ ...clean, ...existing });
  }, [open, format?.id, client?.id, article?.id]);

  const set = (k: keyof DocMetadata, v: string) => setMeta(prev => ({ ...prev, [k]: v }));

  const submit = async (launch: boolean) => {
    if (!format?.id) return;
    setSaving(true);
    try {
      const cleaned: Record<string, unknown> = {};
      for (const [k, v] of Object.entries(meta)) {
        if (typeof v === "string" && v.trim()) cleaned[k] = v.trim();
      }
      const { error } = await supabase.from("ecosystem_formats").update({ metadata: cleaned as any }).eq("id", format.id);
      if (error) throw error;
      if (launch) {
        // Если документ уже был сгенерирован — создаём новую версию, чтобы
        // не затирать предыдущий PDF/страницу/URL. Первая генерация идёт
        // в исходную запись.
        const alreadyGenerated = !!(format?.generated_at || format?.content || format?.pdf_path);
        const { error: fnErr } = await supabase.functions.invoke("generate-document", {
          body: {
            ecosystem_format_id: format.id,
            ...(alreadyGenerated ? { force_new_version: true } : {}),
          },
        });
        if (fnErr) throw fnErr;
        toast.success(alreadyGenerated
          ? "Создали новую версию документа"
          : "Запустили генерацию с указанными метаданными");
      } else {
        toast.success("Метаданные сохранены");
      }
      onOpenChange(false);
      onGenerated?.();
    } catch (e: any) {
      toast.error(e?.message || "Ошибка");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Метаданные документа</DialogTitle>
          <DialogDescription>
            Заполните поля - они попадут в промпт генератору и в вёрстку PDF (обложка, паспорт, автор, CTA). Пустые поля заменяются данными клиента или значениями по умолчанию.
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {FIELDS.map(f => (
            <div key={f.key} className={f.multiline ? "md:col-span-2 space-y-1" : "space-y-1"}>
              <Label className="text-xs">{f.label}</Label>
              {f.multiline ? (
                <Textarea
                  value={(meta[f.key] as string) || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  rows={3}
                />
              ) : (
                <Input
                  value={(meta[f.key] as string) || ""}
                  onChange={(e) => set(f.key, e.target.value)}
                  placeholder={f.placeholder}
                />
              )}
              {f.hint && <p className="text-[11px] text-muted-foreground">{f.hint}</p>}
            </div>
          ))}
        </div>

        <DialogFooter className="gap-2">
          <Button variant="outline" onClick={() => submit(false)} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
          <Button onClick={() => submit(true)} disabled={saving}>
            {saving ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Sparkles className="h-4 w-4 mr-2" />}
            Сохранить и сгенерировать
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}