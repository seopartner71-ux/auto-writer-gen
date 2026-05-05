import { useCallback, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { UserPlus } from "lucide-react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useI18n } from "@/shared/hooks/useI18n";

interface TransferDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  articleId: string | null;
  onSuccess?: () => void;
}

/**
 * Admin: transfer article to another user by email.
 * Extracted from ArticlesPage.tsx (Step 1 refactor).
 */
export function TransferDialog({ open, onOpenChange, articleId, onSuccess }: TransferDialogProps) {
  const { t, lang } = useI18n();
  const queryClient = useQueryClient();
  const [email, setEmail] = useState("");

  const handleTransfer = useCallback(async () => {
    if (!articleId || !email.trim()) return;
    try {
      const { data: targetProfile, error: profileErr } = await supabase
        .from("profiles")
        .select("id, email")
        .eq("email", email.trim())
        .single();
      if (profileErr || !targetProfile) {
        toast.error(lang === "ru" ? "Пользователь не найден" : "User not found");
        return;
      }
      const { error: updateErr } = await supabase
        .from("articles")
        .update({ user_id: targetProfile.id })
        .eq("id", articleId);
      if (updateErr) throw updateErr;
      toast.success(lang === "ru" ? `Статья передана ${targetProfile.email}` : `Article transferred to ${targetProfile.email}`);
      onOpenChange(false);
      setEmail("");
      queryClient.invalidateQueries({ queryKey: ["articles-list"] });
      onSuccess?.();
    } catch (e: any) {
      toast.error(e.message || "Transfer failed");
    }
  }, [articleId, email, lang, queryClient, onOpenChange, onSuccess]);

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setEmail(""); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <UserPlus className="h-5 w-5" />
            {lang === "ru" ? "Передать статью пользователю" : "Transfer article to user"}
          </DialogTitle>
          <DialogDescription>
            {lang === "ru" ? "Введите email пользователя, которому хотите передать статью" : "Enter the email of the user to transfer the article to"}
          </DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <Input
            placeholder="user@example.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && email.trim() && handleTransfer()}
          />
          <div className="flex gap-2">
            <Button variant="outline" className="flex-1" onClick={() => onOpenChange(false)}>
              {t("common.close")}
            </Button>
            <Button
              className="flex-1"
              disabled={!email.trim()}
              onClick={handleTransfer}
            >
              <UserPlus className="h-4 w-4 mr-1.5" />
              {lang === "ru" ? "Передать" : "Transfer"}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}