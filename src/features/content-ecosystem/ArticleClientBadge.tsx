import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Client } from "./types";
import { ClientDetailsDialog } from "./ClientDetailsDialog";

interface Props {
  articleId: string | null;
}

export function ArticleClientBadge({ articleId }: Props) {
  const [client, setClient] = useState<Client | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!articleId) { setClient(null); return; }
    void (async () => {
      const { data: art } = await supabase
        .from("articles")
        .select("client_id")
        .eq("id", articleId)
        .maybeSingle();
      const cid = (art as any)?.client_id;
      if (!cid) { if (!cancelled) setClient(null); return; }
      const { data: c } = await supabase.from("clients").select("*").eq("id", cid).maybeSingle();
      if (!cancelled) setClient((c as Client) || null);
    })();
    return () => { cancelled = true; };
  }, [articleId]);

  if (!client) return null;

  return (
    <>
      <button
        type="button"
        onClick={() => setDetailsOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-full border border-border bg-muted/40 hover:border-primary/40 hover:bg-primary/[0.06] px-2.5 py-1 text-xs transition-colors"
        title="Открыть карточку клиента"
      >
        {client.logo_url ? (
          <img src={client.logo_url} alt="" className="h-4 w-4 rounded object-cover" />
        ) : (
          <span
            className="h-4 w-4 rounded flex items-center justify-center text-[8px] font-bold text-white"
            style={{ background: client.brand_color }}
          >
            {client.name.slice(0, 2).toUpperCase()}
          </span>
        )}
        <span className="font-medium">{client.name}</span>
      </button>
      <ClientDetailsDialog
        open={detailsOpen}
        onOpenChange={setDetailsOpen}
        client={client}
        onEdit={() => { /* editing lives on /content-ecosystem */ }}
        onArchived={() => setDetailsOpen(false)}
        canCreateEcosystem={false}
        onCreateEcosystem={() => { /* no-op from editor */ }}
      />
    </>
  );
}