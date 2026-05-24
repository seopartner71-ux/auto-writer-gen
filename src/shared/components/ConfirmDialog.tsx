import { createContext, useCallback, useContext, useState, ReactNode } from "react";
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
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";

type ConfirmOptions = {
  title?: string;
  description?: string;
  confirmText?: string;
  cancelText?: string;
  destructive?: boolean;
};

type PromptOptions = {
  title?: string;
  description?: string;
  placeholder?: string;
  defaultValue?: string;
  confirmText?: string;
  cancelText?: string;
};

type ConfirmState = ConfirmOptions & { resolve: (v: boolean) => void };
type PromptState = PromptOptions & { resolve: (v: string | null) => void };

interface Ctx {
  confirm: (opts: ConfirmOptions | string) => Promise<boolean>;
  prompt: (opts: PromptOptions | string) => Promise<string | null>;
}

const ConfirmCtx = createContext<Ctx | null>(null);

export function ConfirmDialogProvider({ children }: { children: ReactNode }) {
  const [confirmState, setConfirmState] = useState<ConfirmState | null>(null);
  const [promptState, setPromptState] = useState<PromptState | null>(null);
  const [promptValue, setPromptValue] = useState("");

  const confirm = useCallback((opts: ConfirmOptions | string) => {
    const o = typeof opts === "string" ? { description: opts } : opts;
    return new Promise<boolean>((resolve) => setConfirmState({ ...o, resolve }));
  }, []);

  const prompt = useCallback((opts: PromptOptions | string) => {
    const o = typeof opts === "string" ? { title: opts } : opts;
    setPromptValue(o.defaultValue || "");
    return new Promise<string | null>((resolve) => setPromptState({ ...o, resolve }));
  }, []);

  const closeConfirm = (val: boolean) => {
    confirmState?.resolve(val);
    setConfirmState(null);
  };

  const closePrompt = (val: string | null) => {
    promptState?.resolve(val);
    setPromptState(null);
  };

  return (
    <ConfirmCtx.Provider value={{ confirm, prompt }}>
      {children}

      <AlertDialog open={!!confirmState} onOpenChange={(o) => !o && closeConfirm(false)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{confirmState?.title || "Подтверждение"}</AlertDialogTitle>
            {confirmState?.description && (
              <AlertDialogDescription className="whitespace-pre-line">
                {confirmState.description}
              </AlertDialogDescription>
            )}
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel onClick={() => closeConfirm(false)}>
              {confirmState?.cancelText || "Отмена"}
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => closeConfirm(true)}
              className={confirmState?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : ""}
            >
              {confirmState?.confirmText || "Подтвердить"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <Dialog open={!!promptState} onOpenChange={(o) => !o && closePrompt(null)}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{promptState?.title || "Ввод"}</DialogTitle>
            {promptState?.description && (
              <DialogDescription>{promptState.description}</DialogDescription>
            )}
          </DialogHeader>
          <Input
            autoFocus
            value={promptValue}
            placeholder={promptState?.placeholder}
            onChange={(e) => setPromptValue(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") closePrompt(promptValue);
              if (e.key === "Escape") closePrompt(null);
            }}
          />
          <DialogFooter>
            <Button variant="ghost" onClick={() => closePrompt(null)}>
              {promptState?.cancelText || "Отмена"}
            </Button>
            <Button onClick={() => closePrompt(promptValue)}>
              {promptState?.confirmText || "ОК"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </ConfirmCtx.Provider>
  );
}

export function useConfirm() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("useConfirm must be used within ConfirmDialogProvider");
  return ctx.confirm;
}

export function usePrompt() {
  const ctx = useContext(ConfirmCtx);
  if (!ctx) throw new Error("usePrompt must be used within ConfirmDialogProvider");
  return ctx.prompt;
}