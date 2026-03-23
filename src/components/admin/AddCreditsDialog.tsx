import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { useQueryClient } from "@tanstack/react-query";
import { Coins } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  user: { id: string; email: string | null; credits_amount: number } | null;
}

export function AddCreditsDialog({ open, onOpenChange, user }: Props) {
  const queryClient = useQueryClient();
  const [amount, setAmount] = useState("10");
  const [comment, setComment] = useState("");
  const [notify, setNotify] = useState(true);
  const [loading, setLoading] = useState(false);

  const handleSubmit = async () => {
    if (!user) return;
    const num = parseInt(amount);
    if (!num || num < 1) {
      toast.error("Укажите корректное количество кредитов");
      return;
    }

    setLoading(true);
    try {
      const { data, error } = await supabase.rpc("admin_add_credits", {
        p_user_id: user.id,
        p_amount: num,
        p_notify: notify,
        p_comment: comment,
      });
      if (error) throw error;
      toast.success(`Начислено ${num} кредитов пользователю ${user.email}`);
      queryClient.invalidateQueries({ queryKey: ["admin-profiles"] });
      onOpenChange(false);
      setAmount("10");
      setComment("");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setLoading(false);
    }
  };

  if (!user) return null;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Coins className="h-5 w-5 text-primary" />
            Начислить кредиты
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="text-sm text-muted-foreground">
            Пользователь: <span className="font-mono text-foreground">{user.email}</span>
            <br />
            Текущий баланс: <span className="font-semibold text-foreground">{user.credits_amount}</span> кредитов
          </div>

          <div className="space-y-2">
            <Label htmlFor="credits-amount">Количество кредитов</Label>
            <Input
              id="credits-amount"
              type="number"
              min={1}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="credits-comment">Комментарий для пользователя</Label>
            <Textarea
              id="credits-comment"
              placeholder="Бонус за бета-тест"
              value={comment}
              onChange={(e) => setComment(e.target.value)}
              rows={2}
            />
          </div>

          <div className="flex items-center gap-2">
            <Checkbox
              id="credits-notify"
              checked={notify}
              onCheckedChange={(v) => setNotify(v === true)}
            />
            <Label htmlFor="credits-notify" className="text-sm cursor-pointer">
              Отправить уведомление пользователю
            </Label>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button onClick={handleSubmit} disabled={loading}>
            {loading ? "Начисляю…" : `Начислить ${amount || 0} кредитов`}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
