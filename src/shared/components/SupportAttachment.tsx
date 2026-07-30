import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

const BUCKET = "support-attachments";
const MAX_SIZE = 5 * 1024 * 1024; // 5 MB

export function validateSupportImage(file: File): "not_image" | "too_large" | null {
  if (!file.type.startsWith("image/")) return "not_image";
  if (file.size > MAX_SIZE) return "too_large";
  return null;
}

export async function uploadSupportAttachment(userId: string, file: File): Promise<string> {
  const ext = file.name.split(".").pop()?.toLowerCase() || "png";
  const path = `${userId}/${crypto.randomUUID()}.${ext}`;
  const { error } = await supabase.storage.from(BUCKET).upload(path, file, { contentType: file.type });
  if (error) throw error;
  return path;
}

export function SupportAttachmentImage({ path }: { path: string }) {
  const [url, setUrl] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    supabase.storage
      .from(BUCKET)
      .createSignedUrl(path, 3600)
      .then(({ data }) => {
        if (!cancelled && data?.signedUrl) setUrl(data.signedUrl);
      });
    return () => {
      cancelled = true;
    };
  }, [path]);

  if (!url) return <div className="h-24 w-36 rounded-md bg-muted animate-pulse" />;

  return (
    <a href={url} target="_blank" rel="noopener noreferrer">
      <img
        src={url}
        alt="attachment"
        loading="lazy"
        className="max-h-48 max-w-full rounded-md border object-contain cursor-zoom-in"
      />
    </a>
  );
}