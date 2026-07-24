import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Upload, Plus, Pencil, Archive, Link2 } from "lucide-react";
import { X } from "lucide-react";
import { Client, ClientAnchor, AnchorPriority, slugify, getClientAnchors } from "./types";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { DistributionSection } from "./DistributionSection";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  client?: Client | null;
  onSaved: (client: Client) => void;
}

export function ClientFormDialog({ open, onOpenChange, client, onSaved }: Props) {
  const { user } = useAuth();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [uploadingExpert, setUploadingExpert] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const expertFileInputRef = useRef<HTMLInputElement>(null);
  const [form, setForm] = useState({
    name: "",
    domain: "",
    description: "",
    logo_url: "",
    brand_color: "#7C3AED",
    expert_name: "",
    expert_bio: "",
    expert_photo_url: "",
    contact_email: "",
    contact_phone: "",
    brand_voice: "",
    default_utm_source: "",
  });
  const [anchors, setAnchors] = useState<ClientAnchor[]>([]);
  const [anchorDraft, setAnchorDraft] = useState<ClientAnchor | null>(null);
  const [anchorError, setAnchorError] = useState<string | null>(null);

  const ALLOWED_MIME = new Set([
    "image/png", "image/jpeg", "image/jpg", "image/svg+xml", "image/webp",
  ]);
  const ALLOWED_EXT = new Set(["png", "jpg", "jpeg", "svg", "webp"]);

  const getExt = (name: string) =>
    (name.split(".").pop() || "").toLowerCase().replace(/[^a-z0-9]/g, "");

  const getMimeType = (file: File, ext: string) => {
    if (file.type && ALLOWED_MIME.has(file.type.toLowerCase())) return file.type.toLowerCase();
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "svg") return "image/svg+xml";
    if (ext === "webp") return "image/webp";
    return "image/png";
  };

  const isImageFileValid = (file: File) => {
    const ext = getExt(file.name);
    const mimeOk = file.type ? ALLOWED_MIME.has(file.type.toLowerCase()) : false;
    const extOk = ALLOWED_EXT.has(ext);
    return mimeOk || extOk;
  };

  async function uploadToBucket(
    bucket: "client-logos" | "client-experts",
    file: File,
    logTag: string,
  ): Promise<string> {
    const ext = getExt(file.name) || "png";
    const contentType = getMimeType(file, ext);
    if (!file || file.size === 0) throw new Error("Файл пустой или не выбран");
    // Stable per-slot path so upsert:true replaces the previous file cleanly.
    const slot = bucket === "client-logos" ? "logo" : "expert";
    const path = `${user!.id}/${crypto.randomUUID()}-${slot}.${ext}`;
    console.log(`[${logTag}] upload started`, {
      name: file.name, size: file.size, type: file.type, contentType, bucket, path,
    });
    // Pass the File object DIRECTLY into the SDK — no intermediate ArrayBuffer,
    // no manual fetch. The SDK builds the correct multipart body itself and
    // the previous "No content provided" 400 no longer occurs.
    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, file, {
        contentType,
        upsert: true,
        cacheControl: "3600",
      });
    if (upErr) {
      console.error(`[${logTag}] upload failed`, upErr);
      throw new Error(upErr.message || "Ошибка загрузки в Storage");
    }
    const { data, error: urlErr } = await supabase.storage
      .from(bucket)
      .createSignedUrl(path, 60 * 60 * 24 * 365);
    if (urlErr) throw urlErr;
    if (!data?.signedUrl) throw new Error("Не удалось получить ссылку на файл");
    console.log(`[${logTag}] upload completed`, { path });
    return data.signedUrl;
  }

  useEffect(() => {
    if (!open) return;
    if (client) {
      setForm({
        name: client.name ?? "",
        domain: client.domain ?? "",
        description: client.description ?? "",
        logo_url: client.logo_url ?? "",
        brand_color: client.brand_color ?? "#7C3AED",
        expert_name: client.expert_name ?? "",
        expert_bio: client.expert_bio ?? "",
        expert_photo_url: client.expert_photo_url ?? "",
        contact_email: client.contact_email ?? "",
        contact_phone: client.contact_phone ?? "",
        brand_voice: client.brand_voice ?? "",
        default_utm_source: client.default_utm_source ?? "",
      });
      setAnchors(getClientAnchors(client));
    } else {
      setForm({
        name: "", domain: "", description: "", logo_url: "",
        brand_color: "#7C3AED", expert_name: "", expert_bio: "",
        expert_photo_url: "", contact_email: "", contact_phone: "",
        brand_voice: "", default_utm_source: "",
      });
      setAnchors([]);
    }
    setAnchorDraft(null);
    setAnchorError(null);
  }, [open, client]);

  const handleLogoUpload = async (file: File) => {
    if (!user) { toast.error("Нужно войти"); return; }
    console.log("[FILE-UPLOAD-LOGO] file selected", { name: file?.name, size: file?.size, type: file?.type });
    if (!file || file.size === 0) { toast.error("Файл пустой или не выбран"); return; }
    if (!isImageFileValid(file)) { toast.error("Выберите PNG, JPG, SVG или WEBP"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Файл больше 2 МБ"); return; }
    setUploading(true);
    try {
      const url = await uploadToBucket("client-logos", file, "FILE-UPLOAD-LOGO");
      setForm(f => ({ ...f, logo_url: url }));
      toast.success("Логотип загружен");
    } catch (e: any) {
      console.error("[FILE-UPLOAD-LOGO] error", e);
      toast.error(`Не удалось загрузить логотип: ${e?.message || "ошибка"}`);
    } finally {
      setUploading(false);
    }
  };

  const handleExpertPhotoUpload = async (file: File) => {
    if (!user) { toast.error("Нужно войти"); return; }
    console.log("[FILE-UPLOAD-EXPERT] file selected", { name: file?.name, size: file?.size, type: file?.type });
    if (!file || file.size === 0) { toast.error("Файл пустой или не выбран"); return; }
    if (!isImageFileValid(file)) { toast.error("Выберите PNG, JPG, SVG или WEBP"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Файл больше 2 МБ"); return; }
    setUploadingExpert(true);
    try {
      const url = await uploadToBucket("client-experts", file, "FILE-UPLOAD-EXPERT");
      setForm(f => ({ ...f, expert_photo_url: url }));
      toast.success("Фото эксперта загружено");
    } catch (e: any) {
      console.error("[FILE-UPLOAD-EXPERT] error", e);
      toast.error(`Не удалось загрузить фото: ${e?.message || "ошибка"}`);
    } finally {
      setUploadingExpert(false);
    }
  };

  const handleExpertDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const f = e.dataTransfer.files?.[0];
    if (f) void handleExpertPhotoUpload(f);
  };

  const formatPhone = (raw: string) => {
    const digits = raw.replace(/\D/g, "").slice(0, 11);
    if (!digits) return "";
    const normalized = digits[0] === "8" ? "7" + digits.slice(1) : digits;
    const d = normalized.padEnd(11, "").slice(0, 11);
    let out = "+7";
    if (d.length > 1) out += " (" + d.slice(1, 4);
    if (d.length >= 4) out += ")";
    if (d.length >= 5) out += " " + d.slice(4, 7);
    if (d.length >= 8) out += "-" + d.slice(7, 9);
    if (d.length >= 10) out += "-" + d.slice(9, 11);
    return out;
  };

  const isValidEmail = (s: string) => !s || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);

  const cleanDomain = (raw: string) => raw.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();

  const defaultAnchorUrl = () => {
    const d = cleanDomain(form.domain);
    return d ? `https://${d}/` : "https://";
  };

  const startNewAnchor = () => {
    setAnchorError(null);
    setAnchorDraft({
      id: crypto.randomUUID(),
      text: "",
      text_variants: [],
      target_url: defaultAnchorUrl(),
      priority: "medium",
      archived: false,
    });
  };

  const editAnchor = (a: ClientAnchor) => {
    setAnchorError(null);
    setAnchorDraft({ ...a });
  };

  const archiveAnchor = async (a: ClientAnchor) => {
    setAnchors(prev => prev.map(x => x.id === a.id ? { ...x, archived: true } : x));
    if (client && user) {
      try {
        await supabase.from("activation_events").insert({
          user_id: user.id,
          event_name: "anchor_archived",
          session_id: "app",
          metadata: { client_id: client.id, anchor_id: a.id },
        });
      } catch { /* noop */ }
    }
  };

  const saveAnchorDraft = async () => {
    if (!anchorDraft) return;
    const text = anchorDraft.text.trim();
    const url = anchorDraft.target_url.trim();
    if (!text) return setAnchorError("Введите текст якоря");
    if (text.length > 100) return setAnchorError("Текст якоря должен быть не длиннее 100 символов");
    const variants = (anchorDraft.text_variants || [])
      .map(v => v.trim())
      .filter(v => v.length > 0);
    if (variants.some(v => v.length > 100)) {
      return setAnchorError("Каждая форма якоря должна быть не длиннее 100 символов");
    }
    const variantLower = variants.map(v => v.toLowerCase());
    if (new Set(variantLower).size !== variantLower.length) {
      return setAnchorError("Дополнительные формы не должны повторяться");
    }
    if (variantLower.includes(text.toLowerCase())) {
      return setAnchorError("Дополнительная форма не должна совпадать с основным текстом");
    }
    if (!/^https:\/\//i.test(url)) return setAnchorError("URL должен начинаться с https://");
    let parsed: URL;
    try { parsed = new URL(url); } catch { return setAnchorError("Некорректный URL"); }
    const cd = cleanDomain(form.domain);
    if (cd) {
      const host = parsed.hostname.toLowerCase();
      const okHost = host === cd || host.endsWith(`.${cd}`);
      if (!okHost) return setAnchorError(`URL должен принадлежать домену ${cd} (или его поддомену)`);
    }
    const dupText = anchors.some(a => a.id !== anchorDraft.id && !a.archived && a.text.trim().toLowerCase() === text.toLowerCase());
    if (dupText) return setAnchorError("Такой текст якоря уже есть");

    const isNew = !anchors.some(a => a.id === anchorDraft.id);
    const next: ClientAnchor = { ...anchorDraft, text, target_url: url, text_variants: variants };
    setAnchors(prev => isNew ? [...prev, next] : prev.map(a => a.id === next.id ? next : a));
    setAnchorDraft(null);
    setAnchorError(null);

    if (user) {
      try {
        await supabase.from("activation_events").insert({
          user_id: user.id,
          event_name: isNew ? "anchor_added" : "anchor_edited",
          session_id: "app",
          metadata: isNew
            ? { client_id: client?.id || null, text, target_url_domain: parsed.hostname }
            : { client_id: client?.id || null, anchor_id: next.id },
        });
      } catch { /* noop */ }
    }
  };

  const activeAnchors = anchors.filter(a => !a.archived);
  const priorityLabel = (p: AnchorPriority) => p === "high" ? "High" : p === "low" ? "Low" : "Medium";

  const handleSave = async () => {
    if (!user) return;
    if (!form.name.trim()) {
      toast.error("Название бренда обязательно");
      return;
    }
    if (!isValidEmail(form.contact_email.trim())) {
      toast.error("Некорректный email");
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        user_id: user.id,
        default_utm_source: form.default_utm_source || slugify(form.name),
        anchors: anchors as unknown as any,
      };
      if (client) {
        const { data, error } = await supabase.from("clients").update(payload).eq("id", client.id).select().single();
        if (error) throw error;
        onSaved(data as Client);
        toast.success("Клиент обновлён");
      } else {
        const { data, error } = await supabase.from("clients").insert(payload).select().single();
        if (error) throw error;
        onSaved(data as Client);
        toast.success("Клиент создан");
        try {
          await supabase.from("activation_events").insert({
            user_id: user.id,
            event_name: "client_created",
            session_id: "app",
            metadata: { client_id: (data as Client).id },
          });
        } catch { /* noop */ }
      }
      onOpenChange(false);
    } catch (e: any) {
      toast.error(e.message || "Ошибка сохранения");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{client ? "Редактировать клиента" : "Новый клиент"}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Название бренда *</Label>
              <Input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} />
            </div>
            <div>
              <Label>Домен</Label>
              <Input placeholder="seo-modul.pro" value={form.domain} onChange={e => setForm(f => ({ ...f, domain: e.target.value }))} />
            </div>
          </div>
          <div>
            <Label>Описание (до 300)</Label>
            <Textarea maxLength={300} rows={2} value={form.description} onChange={e => setForm(f => ({ ...f, description: e.target.value }))} />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Логотип</Label>
              <div className="flex items-center gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploading}
                  onClick={() => fileInputRef.current?.click()}
                >
                  {uploading ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Загрузить
                </Button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp,.png,.jpg,.jpeg,.svg,.webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void handleLogoUpload(f);
                    e.target.value = "";
                  }}
                />
                {form.logo_url && <img src={form.logo_url} alt="logo" className="h-8 w-8 rounded object-cover" />}
              </div>
            </div>
            <div>
              <Label>Цвет бренда</Label>
              <div className="flex items-center gap-2">
                <input type="color" value={form.brand_color} onChange={e => setForm(f => ({ ...f, brand_color: e.target.value }))} className="h-9 w-12 rounded border" />
                <Input value={form.brand_color} onChange={e => setForm(f => ({ ...f, brand_color: e.target.value }))} />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Имя эксперта</Label>
              <Input value={form.expert_name} onChange={e => setForm(f => ({ ...f, expert_name: e.target.value }))} />
            </div>
            <div>
              <Label>UTM source</Label>
              <Input placeholder={slugify(form.name)} value={form.default_utm_source} onChange={e => setForm(f => ({ ...f, default_utm_source: e.target.value }))} />
            </div>
          </div>

          <div>
            <Label>Био эксперта (до 500)</Label>
            <Textarea maxLength={500} rows={2} value={form.expert_bio} onChange={e => setForm(f => ({ ...f, expert_bio: e.target.value }))} />
          </div>

          <div>
            <Label>Фото эксперта (квадрат, до 2 МБ)</Label>
            <div
              onDragOver={e => e.preventDefault()}
              onDrop={handleExpertDrop}
              className="flex items-center gap-3 rounded border border-dashed border-border p-3"
            >
              {form.expert_photo_url ? (
                <img src={form.expert_photo_url} alt="expert" className="h-16 w-16 rounded-full object-cover" />
              ) : (
                <div className="h-16 w-16 rounded-full bg-muted flex items-center justify-center text-xs text-muted-foreground">
                  Нет фото
                </div>
              )}
              <div className="flex-1 space-y-1">
                <p className="text-xs text-muted-foreground">
                  Перетащите PNG/JPG или выберите файл. Обрезка до 512×512 выполняется при загрузке в PDF.
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={uploadingExpert}
                  onClick={() => expertFileInputRef.current?.click()}
                >
                  {uploadingExpert ? <Loader2 className="h-4 w-4 mr-2 animate-spin" /> : <Upload className="h-4 w-4 mr-2" />}
                  Загрузить фото
                </Button>
                <input
                  ref={expertFileInputRef}
                  type="file"
                  accept="image/png,image/jpeg,image/jpg,image/svg+xml,image/webp,.png,.jpg,.jpeg,.svg,.webp"
                  className="hidden"
                  onChange={e => {
                    const f = e.target.files?.[0];
                    if (f) void handleExpertPhotoUpload(f);
                    e.target.value = "";
                  }}
                />
              </div>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label>Контактный email</Label>
              <Input
                type="email"
                placeholder="expert@brand.ru"
                value={form.contact_email}
                onChange={e => setForm(f => ({ ...f, contact_email: e.target.value }))}
              />
            </div>
            <div>
              <Label>Контактный телефон</Label>
              <Input
                inputMode="tel"
                placeholder="+7 (999) 123-45-67"
                value={form.contact_phone}
                onChange={e => setForm(f => ({ ...f, contact_phone: formatPhone(e.target.value) }))}
              />
            </div>
          </div>

          <div>
            <Label>Тональность бренда (до 1500)</Label>
            <Textarea maxLength={1500} rows={5} placeholder="2-3 абзаца описания голоса бренда + примеры фраз." value={form.brand_voice} onChange={e => setForm(f => ({ ...f, brand_voice: e.target.value }))} />
          </div>

          <div className="space-y-3 rounded-md border border-border p-4">
            <div className="flex items-start justify-between gap-3">
              <div>
                <Label className="text-base flex items-center gap-2">
                  <Link2 className="h-4 w-4" /> SEO-якоря
                </Label>
                <p className="text-xs text-muted-foreground mt-1">
                  Список текстовых якорей, которые модель будет вставлять как ссылки в генерируемый контент. Модель выбирает 1-2 наиболее подходящих под тему каждой статьи.
                </p>
              </div>
              <Button type="button" size="sm" variant="outline" onClick={startNewAnchor} disabled={!!anchorDraft}>
                <Plus className="h-4 w-4 mr-1" /> Добавить якорь
              </Button>
            </div>

            {activeAnchors.length === 0 && !anchorDraft ? (
              <div className="rounded border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
                Добавьте первый SEO-якорь, чтобы модель начала вставлять брендовые ссылки в контент.
              </div>
            ) : activeAnchors.length > 0 && (
              <div className="rounded border border-border overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-muted/40 text-xs uppercase text-muted-foreground">
                    <tr>
                      <th className="text-left px-3 py-2 font-medium">Текст якоря</th>
                      <th className="text-left px-3 py-2 font-medium">URL назначения</th>
                      <th className="text-left px-3 py-2 font-medium w-24">Приоритет</th>
                      <th className="px-3 py-2 w-24"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {activeAnchors.map(a => (
                      <tr key={a.id} className="border-t border-border">
                        <td className="px-3 py-2 align-top">{a.text}</td>
                        <td className="px-3 py-2 align-top text-xs text-muted-foreground truncate max-w-[220px]" title={a.target_url}>{a.target_url}</td>
                        <td className="px-3 py-2 align-top text-xs">{priorityLabel(a.priority)}</td>
                        <td className="px-3 py-2 align-top">
                          <div className="flex items-center gap-1 justify-end">
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => editAnchor(a)} title="Редактировать">
                              <Pencil className="h-3.5 w-3.5" />
                            </Button>
                            <Button type="button" variant="ghost" size="icon" className="h-7 w-7" onClick={() => archiveAnchor(a)} title="Архивировать">
                              <Archive className="h-3.5 w-3.5" />
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {anchorDraft && (
              <div className="rounded border border-primary/40 bg-muted/20 p-3 space-y-2">
                <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                  <div>
                    <Label className="text-xs">Текст якоря *</Label>
                    <Input
                      maxLength={100}
                      placeholder="навесное оборудование"
                      value={anchorDraft.text}
                      onChange={e => setAnchorDraft(d => d && ({ ...d, text: e.target.value }))}
                    />
                  </div>
                  <div>
                    <Label className="text-xs">Приоритет</Label>
                    <Select
                      value={anchorDraft.priority}
                      onValueChange={(v) => setAnchorDraft(d => d && ({ ...d, priority: v as AnchorPriority }))}
                    >
                      <SelectTrigger><SelectValue /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="high">High</SelectItem>
                        <SelectItem value="medium">Medium</SelectItem>
                        <SelectItem value="low">Low</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div>
                  <Label className="text-xs">URL назначения *</Label>
                  <Input
                    placeholder="https://example.com/page/"
                    value={anchorDraft.target_url}
                    onChange={e => setAnchorDraft(d => d && ({ ...d, target_url: e.target.value }))}
                  />
                </div>
                <div className="space-y-2 pt-1">
                  <Label className="text-xs">Дополнительные формы (склонения, синонимы)</Label>
                  <p className="text-[11px] text-muted-foreground leading-snug">
                    Модель выберет наиболее подходящую под грамматику текста. Основной текст всегда идет первым в приоритете.
                  </p>
                  {(anchorDraft.text_variants || []).map((v, idx) => (
                    <div key={idx} className="flex items-center gap-2">
                      <Input
                        maxLength={100}
                        placeholder={idx === 0 ? "минитрактора" : "еще одна форма"}
                        value={v}
                        onChange={e => setAnchorDraft(d => {
                          if (!d) return d;
                          const next = [...(d.text_variants || [])];
                          next[idx] = e.target.value;
                          return { ...d, text_variants: next };
                        })}
                      />
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 shrink-0"
                        onClick={() => setAnchorDraft(d => {
                          if (!d) return d;
                          const next = [...(d.text_variants || [])];
                          next.splice(idx, 1);
                          return { ...d, text_variants: next };
                        })}
                        title="Удалить форму"
                      >
                        <X className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                  {(anchorDraft.text_variants || []).length < 8 && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => setAnchorDraft(d => d && ({
                        ...d,
                        text_variants: [...(d.text_variants || []), ""],
                      }))}
                    >
                      <Plus className="h-3.5 w-3.5 mr-1" /> Добавить форму
                    </Button>
                  )}
                </div>
                {anchorError && <p className="text-xs text-destructive">{anchorError}</p>}
                <div className="flex items-center justify-end gap-2 pt-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => { setAnchorDraft(null); setAnchorError(null); }}>Отмена</Button>
                  <Button type="button" size="sm" onClick={saveAnchorDraft}>Сохранить якорь</Button>
                </div>
              </div>
            )}
          </div>

          <DistributionSection
            client={client ?? null}
            onSaved={(patch) => {
              if (client) onSaved({ ...client, ...patch } as Client);
            }}
          />
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Отмена</Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
            Сохранить
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}