// Загрузка реальных фото заказчика: файлы с именами по артикулу или список
// "артикул;ссылка". Никакой генерации - только то, что дал клиент.
import { useCallback, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import { Progress } from "@/components/ui/progress";
import { toast } from "sonner";
import { Upload, Link2, Loader2 } from "lucide-react";

interface AttachResult {
  attached?: number;
  entities?: number;
  unmatched?: string[];
  unmatched_total?: number;
}

const MAX_MB = 8;
const ACCEPT = ["image/jpeg", "image/png", "image/webp"];

export function MediaUploadCard({
  projectId,
  ru,
  onDone,
}: {
  projectId: string;
  ru: boolean;
  onDone: () => void;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [links, setLinks] = useState("");
  const [report, setReport] = useState<AttachResult | null>(null);
  const [drag, setDrag] = useState(false);

  const attach = useCallback(
    async (items: { key: string; url: string }[]) => {
      const { data, error } = await supabase.functions.invoke("media-engine", {
        body: { project_id: projectId, mode: "attach_images", items },
      });
      if (error) throw new Error(error.message);
      if (data?.error) throw new Error(String(data.error));
      return data as AttachResult;
    },
    [projectId],
  );

  const uploadFiles = useCallback(
    async (files: File[]) => {
      const list = files.filter((f) => ACCEPT.includes(f.type));
      if (!list.length) {
        toast.error(ru ? "Подходят только JPG, PNG и WebP" : "Only JPG, PNG and WebP");
        return;
      }
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth?.user?.id;
      if (!uid) {
        toast.error(ru ? "Сессия истекла, войдите заново" : "Session expired, sign in again");
        return;
      }
      setBusy(true);
      setProgress(0);
      setReport(null);
      const items: { key: string; url: string }[] = [];
      const tooBig: string[] = [];
      try {
        for (let i = 0; i < list.length; i++) {
          const file = list[i];
          if (file.size > MAX_MB * 1024 * 1024) {
            tooBig.push(file.name);
          } else {
            const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
            const path = `${uid}/catalog/${projectId}/${Date.now()}-${i}-${Math.random()
              .toString(36)
              .slice(2, 7)}.${ext}`;
            const { error } = await supabase.storage
              .from("article-images")
              .upload(path, file, { contentType: file.type, upsert: false });
            if (error) throw new Error(error.message);
            const { data } = supabase.storage.from("article-images").getPublicUrl(path);
            items.push({ key: file.name, url: data.publicUrl });
          }
          setProgress(Math.round(((i + 1) / list.length) * 100));
        }
        if (tooBig.length) {
          toast.error(
            `${ru ? "Слишком большие файлы" : "Files too large"} (${MAX_MB} MB): ${tooBig
              .slice(0, 3)
              .join(", ")}${tooBig.length > 3 ? "..." : ""}`,
          );
        }
        if (!items.length) return;
        const res = await attach(items);
        setReport(res);
        toast.success(
          `${ru ? "Привязано фото" : "Photos attached"}: ${res.attached ?? 0}` +
            (res.unmatched_total ? ` - ${ru ? "не найдено совпадений" : "no match"}: ${res.unmatched_total}` : ""),
        );
        onDone();
      } catch (e) {
        toast.error((e as Error).message);
      } finally {
        setBusy(false);
        setProgress(0);
      }
    },
    [attach, onDone, projectId, ru],
  );

  const attachLinks = useCallback(async () => {
    const items = links
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const parts = line.split(/[;,\t]/).map((p) => p.trim());
        const url = parts.find((p) => /^https?:\/\//i.test(p)) || "";
        const key = parts.find((p) => p && p !== url) || "";
        return { key, url };
      })
      .filter((x) => x.url && x.key);
    if (!items.length) {
      toast.error(ru ? "Нужны строки вида: артикул;ссылка" : "Lines must look like: sku;url");
      return;
    }
    setBusy(true);
    setReport(null);
    try {
      const res = await attach(items);
      setReport(res);
      toast.success(`${ru ? "Привязано фото" : "Photos attached"}: ${res.attached ?? 0}`);
      onDone();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }, [attach, links, onDone, ru]);

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Upload className="h-4 w-4" /> {ru ? "Загрузить фото заказчика" : "Upload customer photos"}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDrag(true);
          }}
          onDragLeave={() => setDrag(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDrag(false);
            if (!busy) void uploadFiles(Array.from(e.dataTransfer.files));
          }}
          onClick={() => !busy && inputRef.current?.click()}
          className={`cursor-pointer rounded-lg border border-dashed p-6 text-center text-sm transition-colors ${
            drag ? "border-primary bg-muted/50" : "border-border"
          }`}
        >
          <input
            ref={inputRef}
            type="file"
            accept="image/jpeg,image/png,image/webp"
            multiple
            className="hidden"
            onChange={(e) => {
              const files = Array.from(e.target.files || []);
              e.target.value = "";
              if (files.length) void uploadFiles(files);
            }}
          />
          {busy ? (
            <span className="inline-flex items-center gap-2">
              <Loader2 className="h-4 w-4 animate-spin" />
              {ru ? "Загрузка" : "Uploading"}
            </span>
          ) : (
            <>
              <p className="font-medium">
                {ru ? "Перетащите фото сюда или нажмите" : "Drop photos here or click"}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {ru
                  ? "Имя файла = артикул товара. Несколько фото одного товара: артикул-1.jpg, артикул-2.jpg. JPG, PNG, WebP до 8 МБ."
                  : "File name = product SKU. Several photos: sku-1.jpg, sku-2.jpg. JPG, PNG, WebP up to 8 MB."}
              </p>
            </>
          )}
        </div>
        {busy && progress > 0 && <Progress value={progress} className="h-2" />}

        <div className="space-y-2">
          <p className="text-xs text-muted-foreground">
            {ru
              ? "Или вставьте список: артикул;ссылка на фото - по одной строке."
              : "Or paste a list: sku;photo url - one per line."}
          </p>
          <Textarea
            value={links}
            onChange={(e) => setLinks(e.target.value)}
            rows={4}
            placeholder={"AB-1234;https://..."}
            disabled={busy}
          />
          <Button size="sm" variant="outline" disabled={busy || !links.trim()} onClick={() => void attachLinks()}>
            <Link2 className="mr-2 h-4 w-4" />
            {ru ? "Привязать по ссылкам" : "Attach by links"}
          </Button>
        </div>

        {report && (
          <div className="rounded-lg border border-border p-3 text-sm">
            <p>
              {ru ? "Привязано фото" : "Photos attached"}: <b>{report.attached ?? 0}</b>
              {" - "}
              {ru ? "товаров" : "entities"}: <b>{report.entities ?? 0}</b>
            </p>
            {!!report.unmatched_total && (
              <>
                <p className="mt-1 text-amber-500">
                  {ru ? "Не нашли товар по имени файла" : "No product matched the file name"}:{" "}
                  {report.unmatched_total}
                </p>
                <p className="mt-1 break-all text-xs text-muted-foreground">
                  {(report.unmatched || []).slice(0, 10).join(", ")}
                </p>
              </>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
