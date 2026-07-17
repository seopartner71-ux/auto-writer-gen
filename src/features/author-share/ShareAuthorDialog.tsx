import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Share2, UserPlus, Trash2, Loader2 } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  authorProfileId: string;
  ownerId: string;
  authorName: string;
}

interface ShareRow {
  id: string;
  shared_with_user_id: string;
  created_at: string;
  email: string | null;
}

/**
 * Share an author profile with another registered user by email.
 * Both the owner and the recipient will see the author in their list.
 */
export function ShareAuthorDialog({ open, onOpenChange, authorProfileId, ownerId, authorName }: Props) {
  const { lang } = useI18n();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const ru = lang === "ru";
  const L = {
    title: ru ? "Поделиться автором" : "Share author",
    desc: ru
      ? "Введите email пользователя. У него появится этот автор в списке (только чтение)."
      : "Enter the user's email. They will see this author in their list (read-only).",
    placeholder: ru ? "email@example.com" : "email@example.com",
    add: ru ? "Дать доступ" : "Grant access",
    close: ru ? "Закрыть" : "Close",
    granted: ru ? "Доступ выдан:" : "Access granted:",
    empty: ru ? "Пока никому не выдан доступ." : "Not shared with anyone yet.",
    revoke: ru ? "Отозвать" : "Revoke",
    userNotFound: ru ? "Пользователь не найден" : "User not found",
    cantShareSelf: ru ? "Нельзя поделиться с самим собой" : "You cannot share with yourself",
    alreadyShared: ru ? "Доступ уже выдан" : "Access already granted",
    accessRevoked: ru ? "Доступ отозван" : "Access revoked",
    successShared: ru ? `Автор "${authorName}" передан` : `Author "${authorName}" shared`,
  };

  const sharesQuery = useQuery({
    queryKey: ["author-shares", authorProfileId],
    enabled: open,
    queryFn: async () => {
      const { data: shares, error } = await supabase
        .from("author_profile_shares")
        .select("id, shared_with_user_id, created_at")
        .eq("author_profile_id", authorProfileId)
        .order("created_at", { ascending: false });
      if (error) throw error;
      const ids = (shares ?? []).map((s) => s.shared_with_user_id);
      let emailMap: Record<string, string | null> = {};
      if (ids.length > 0) {
        const { data: profiles } = await supabase
          .from("profiles")
          .select("id, email")
          .in("id", ids);
        emailMap = Object.fromEntries((profiles ?? []).map((p) => [p.id, p.email]));
      }
      return (shares ?? []).map<ShareRow>((s) => ({
        id: s.id,
        shared_with_user_id: s.shared_with_user_id,
        created_at: s.created_at,
        email: emailMap[s.shared_with_user_id] ?? null,
      }));
    },
  });

  const grantAccess = useMutation({
    mutationFn: async () => {
      const target = email.trim().toLowerCase();
      if (!target) return;
      const { data: profile, error: profErr } = await supabase
        .from("profiles")
        .select("id")
        .eq("email", target)
        .maybeSingle();
      if (profErr) throw profErr;
      if (!profile) throw new Error(L.userNotFound);
      if (profile.id === ownerId) throw new Error(L.cantShareSelf);
      const { error: insErr } = await supabase.from("author_profile_shares").insert({
        author_profile_id: authorProfileId,
        owner_id: ownerId,
        shared_with_user_id: profile.id,
      });
      if (insErr) {
        if (insErr.code === "23505") throw new Error(L.alreadyShared);
        throw insErr;
      }
    },
    onSuccess: () => {
      toast.success(L.successShared);
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["author-shares", authorProfileId] });
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  const revokeAccess = useMutation({
    mutationFn: async (shareId: string) => {
      const { error } = await supabase.from("author_profile_shares").delete().eq("id", shareId);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success(L.accessRevoked);
      queryClient.invalidateQueries({ queryKey: ["author-shares", authorProfileId] });
    },
    onError: (e: any) => toast.error(e.message || "Error"),
  });

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setEmail(""); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Share2 className="h-5 w-5" />
            {L.title}
          </DialogTitle>
          <DialogDescription>{L.desc}</DialogDescription>
        </DialogHeader>

        <div className="space-y-4">
          <div className="flex gap-2">
            <Input
              placeholder={L.placeholder}
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && email.trim() && grantAccess.mutate()}
            />
            <Button
              disabled={!email.trim() || grantAccess.isPending}
              onClick={() => grantAccess.mutate()}
            >
              {grantAccess.isPending
                ? <Loader2 className="h-4 w-4 animate-spin" />
                : <UserPlus className="h-4 w-4 mr-1.5" />}
              {L.add}
            </Button>
          </div>

          <div className="space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{L.granted}</p>
            {sharesQuery.isLoading ? (
              <div className="flex justify-center py-4"><Loader2 className="h-4 w-4 animate-spin text-muted-foreground" /></div>
            ) : (sharesQuery.data?.length ?? 0) === 0 ? (
              <p className="text-xs text-muted-foreground py-2">{L.empty}</p>
            ) : (
              <ul className="space-y-1.5 max-h-56 overflow-y-auto">
                {sharesQuery.data!.map((s) => (
                  <li key={s.id} className="flex items-center justify-between gap-2 text-sm border rounded-md px-3 py-1.5">
                    <span className="truncate">{s.email ?? s.shared_with_user_id}</span>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 text-destructive hover:text-destructive"
                      onClick={() => revokeAccess.mutate(s.id)}
                      disabled={revokeAccess.isPending}
                    >
                      <Trash2 className="h-3.5 w-3.5 mr-1" />
                      {L.revoke}
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end">
            <Button variant="outline" onClick={() => onOpenChange(false)}>{L.close}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}