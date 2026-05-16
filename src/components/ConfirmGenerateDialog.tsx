import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Coins, AlertTriangle } from "lucide-react";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  credits: number;
  balance: number;
  modelName?: string;
  onConfirm: () => void;
}

/**
 * Confirmation dialog shown before generation when cost exceeds 20 credits
 * or 30% of user's balance. Prevents accidental burn on Opus + Stealth combos.
 */
export function ConfirmGenerateDialog({
  open, onOpenChange, credits, balance, modelName, onConfirm,
}: Props) {
  const pct = balance > 0 ? Math.round((credits / balance) * 100) : 100;
  const danger = pct >= 30;

  return (
    <AlertDialog open={open} onOpenChange={onOpenChange}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            {danger ? (
              <AlertTriangle className="h-5 w-5 text-amber-500" />
            ) : (
              <Coins className="h-5 w-5 text-primary" />
            )}
            Подтвердите генерацию
          </AlertDialogTitle>
          <AlertDialogDescription className="space-y-2 pt-2">
            <div>
              Эта статья спишет <span className="font-bold text-foreground">{credits} кредитов</span>
              {modelName ? ` (модель ${modelName})` : ""}.
            </div>
            <div>
              Ваш баланс: <span className="font-mono">{balance}</span> кр.
              {danger && (
                <span className="text-amber-500 font-medium"> Это около {pct}% месячного баланса.</span>
              )}
            </div>
            <div className="text-xs text-muted-foreground pt-1">
              После списания останется {Math.max(0, balance - credits)} кр.
            </div>
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Отмена</AlertDialogCancel>
          <AlertDialogAction onClick={onConfirm}>
            Сгенерировать за {credits} кр
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}