import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue, SelectSeparator,
} from "@/components/ui/select";
import { Plus } from "lucide-react";
import { Client, limitsForPlan } from "./types";
import { ClientFormDialog } from "./ClientFormDialog";

const ADD_NEW = "__add_new__";
const NONE_VAL = "__none__";

interface Props {
  value: string | null;
  onChange: (id: string | null, client: Client | null) => void;
  onClientCreated?: (client: Client) => void;
  disabled?: boolean;
  label?: string;
  placeholder?: string;
}

export function ClientPickerDropdown({
  value, onChange, onClientCreated, disabled,
  label = "Для какого клиента?",
  placeholder = "Без клиента (личная статья)",
}: Props) {
  const { user, profile } = useAuth();
  const [createOpen, setCreateOpen] = useState(false);
  const plan = String((profile as any)?.plan || "").toLowerCase();
  const limits = limitsForPlan(plan);
  const isLocked = limits.clientLimit === 0; // NANO

  const { data: clients = [], refetch } = useQuery({
    queryKey: ["cp-clients", user?.id],
    enabled: !!user?.id,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("clients")
        .select("*")
        .eq("user_id", user!.id)
        .eq("archived", false)
        .order("updated_at", { ascending: false });
      if (error) throw error;
      return (data || []) as Client[];
    },
  });

  // Validate URL-supplied client_id when list arrives.
  useEffect(() => {
    if (!value || !clients.length) return;
    const found = clients.find((c) => c.id === value);
    if (!found) onChange(null, null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clients, value]);

  const selectValue = isLocked ? NONE_VAL : (value || NONE_VAL);

  const handleChange = (v: string) => {
    if (v === ADD_NEW) {
      setCreateOpen(true);
      return;
    }
    if (v === NONE_VAL) {
      onChange(null, null);
      return;
    }
    const c = clients.find((x) => x.id === v) || null;
    onChange(v, c);
  };

  return (
    <div className="space-y-1.5">
      <label className="text-sm font-medium block">{label}</label>
      <Select value={selectValue} onValueChange={handleChange} disabled={disabled || isLocked}>
        <SelectTrigger className="h-11">
          <SelectValue placeholder={placeholder} />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value={NONE_VAL}>{placeholder}</SelectItem>
          {clients.length > 0 && <SelectSeparator />}
          {clients.map((c) => (
            <SelectItem key={c.id} value={c.id}>
              <span className="inline-flex items-center gap-2">
                {c.logo_url ? (
                  <img src={c.logo_url} alt="" className="h-5 w-5 rounded object-cover" />
                ) : (
                  <span
                    className="h-5 w-5 rounded flex items-center justify-center text-[9px] font-bold text-white"
                    style={{ background: c.brand_color }}
                  >
                    {c.name.slice(0, 2).toUpperCase()}
                  </span>
                )}
                <span className="font-medium">{c.name}</span>
                {c.domain && (
                  <span className="text-xs text-muted-foreground">· {c.domain}</span>
                )}
              </span>
            </SelectItem>
          ))}
          {!isLocked && (
            <>
              <SelectSeparator />
              <SelectItem value={ADD_NEW}>
                <span className="inline-flex items-center gap-2 text-primary">
                  <Plus className="h-4 w-4" /> Добавить нового клиента
                </span>
              </SelectItem>
            </>
          )}
        </SelectContent>
      </Select>
      {isLocked && (
        <p className="text-xs text-muted-foreground">
          Работа с клиентами - с тарифа{" "}
          <a href="/pricing" className="text-primary underline underline-offset-2">PRO</a>.
        </p>
      )}

      <ClientFormDialog
        open={createOpen}
        onOpenChange={setCreateOpen}
        client={null}
        onSaved={(c) => {
          void refetch();
          onChange(c.id, c);
          onClientCreated?.(c);
        }}
      />
    </div>
  );
}