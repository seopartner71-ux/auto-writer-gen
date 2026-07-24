import { useEffect, useRef, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { toast } from "sonner";
import { Loader2, Upload } from "lucide-react";
import { Client, slugify } from "./types";

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

  const getLogoMimeType = (file: File, ext: string) => {
    if (file.type) return file.type;
    if (ext === "jpg" || ext === "jpeg") return "image/jpeg";
    if (ext === "svg") return "image/svg+xml";
    if (ext === "webp") return "image/webp";
    return "image/png";
  };

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
    } else {
      setForm({
        name: "", domain: "", description: "", logo_url: "",
        brand_color: "#7C3AED", expert_name: "", expert_bio: "",
        expert_photo_url: "", contact_email: "", contact_phone: "",
        brand_voice: "", default_utm_source: "",
      });
    }
  }, [open, client]);

  const handleLogoUpload = async (file: File) => {
    if (!user) { toast.error("Нужно войти"); return; }
    if (!file || file.size === 0) {
      toast.error("Файл пустой или не выбран");
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      toast.error("Файл больше 2 МБ");
      return;
    }
    setUploading(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error("Файл пустой или не выбран");
      const contentType = getLogoMimeType(file, ext);
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      // Обходим storage-js: грузим напрямую multipart/form-data через REST
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Нет активной сессии");
      const supabaseUrl = (supabase as any).supabaseUrl || (import.meta as any).env?.VITE_SUPABASE_URL;
      const fd = new FormData();
      fd.append("cacheControl", "3600");
      fd.append("", new Blob([bytes], { type: contentType }), `logo.${ext}`);
      const resp = await fetch(`${supabaseUrl}/storage/v1/object/client-logos/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-upsert": "false" },
        body: fd,
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Storage ${resp.status}: ${txt || resp.statusText}`);
      }
      const { data, error: urlErr } = await supabase.storage
        .from("client-logos")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (urlErr) throw urlErr;
      if (!data?.signedUrl) throw new Error("Не удалось получить ссылку на файл");
      setForm(f => ({ ...f, logo_url: data.signedUrl }));
      toast.success("Логотип загружен");
    } catch (e: any) {
      console.error("[client-logo upload]", e);
      const message = String(e?.message || "");
      toast.error(message.includes("No content provided") ? "Файл не прочитан. Выберите PNG, JPG, SVG или WEBP" : (message || "Ошибка загрузки"));
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const handleExpertPhotoUpload = async (file: File) => {
    if (!user) { toast.error("Нужно войти"); return; }
    if (!file || file.size === 0) { toast.error("Файл пустой или не выбран"); return; }
    if (file.size > 2 * 1024 * 1024) { toast.error("Файл больше 2 МБ"); return; }
    setUploadingExpert(true);
    try {
      const ext = (file.name.split(".").pop() || "png").toLowerCase().replace(/[^a-z0-9]/g, "") || "png";
      const bytes = await file.arrayBuffer();
      if (bytes.byteLength === 0) throw new Error("Файл пустой или не выбран");
      const contentType = getLogoMimeType(file, ext);
      const path = `${user.id}/${crypto.randomUUID()}.${ext}`;
      const { data: sess } = await supabase.auth.getSession();
      const token = sess?.session?.access_token;
      if (!token) throw new Error("Нет активной сессии");
      const supabaseUrl = (supabase as any).supabaseUrl || (import.meta as any).env?.VITE_SUPABASE_URL;
      const fd = new FormData();
      fd.append("cacheControl", "3600");
      fd.append("", new Blob([bytes], { type: contentType }), `expert.${ext}`);
      const resp = await fetch(`${supabaseUrl}/storage/v1/object/client-experts/${path}`, {
        method: "POST",
        headers: { Authorization: `Bearer ${token}`, "x-upsert": "false" },
        body: fd,
      });
      if (!resp.ok) {
        const txt = await resp.text().catch(() => "");
        throw new Error(`Storage ${resp.status}: ${txt || resp.statusText}`);
      }
      const { data, error: urlErr } = await supabase.storage
        .from("client-experts")
        .createSignedUrl(path, 60 * 60 * 24 * 365);
      if (urlErr) throw urlErr;
      if (!data?.signedUrl) throw new Error("Не удалось получить ссылку на файл");
      setForm(f => ({ ...f, expert_photo_url: data.signedUrl }));
      toast.success("Фото эксперта загружено");
    } catch (e: any) {
      console.error("[expert-photo upload]", e);
      toast.error(e?.message || "Ошибка загрузки");
    } finally {
      setUploadingExpert(false);
      if (expertFileInputRef.current) expertFileInputRef.current.value = "";
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
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleLogoUpload(f); }}
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
                  accept="image/png,image/jpeg"
                  className="hidden"
                  onChange={e => { const f = e.target.files?.[0]; if (f) void handleExpertPhotoUpload(f); }}
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