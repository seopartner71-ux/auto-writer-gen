import { useEffect, useRef, useState } from "react";
import { MessageCircle, X, Send, Trash2, Loader2, Sparkles } from "lucide-react";
import ReactMarkdown from "react-markdown";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent } from "@/components/ui/sheet";
import { useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

interface Msg { role: "user" | "assistant"; content: string; ts: number }

const STORAGE_KEY = "ai_assistant_history";
const QUICK = [
  "Что такое LSI термины?",
  "Как работает Тургенев?",
  "Как сделать bulk генерацию?",
  "Как улучшить AI Score?",
];
const HIDDEN_ROUTES = ["/", "/login", "/register", "/forgot-password", "/reset-password"];

export function AIAssistantFab() {
  const { pathname } = useLocation();
  const [open, setOpen] = useState(false);
  const [history, setHistory] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) setHistory(JSON.parse(raw));
    } catch { /* ignore */ }
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(history.slice(-20))); } catch { /* ignore */ }
    setTimeout(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, 60);
  }, [history, open]);

  if (HIDDEN_ROUTES.includes(pathname)) return null;

  const send = async (text: string) => {
    const q = text.trim();
    if (!q || loading) return;
    const next: Msg[] = [...history, { role: "user", content: q, ts: Date.now() }];
    setHistory(next);
    setInput("");
    setLoading(true);
    try {
      const payload = next.slice(-10).map(m => ({ role: m.role, content: m.content }));
      const { data, error } = await supabase.functions.invoke("ai-assistant", {
        body: { messages: payload, language: "ru" },
      });
      if (error) throw error;
      if ((data as any)?.error === "limit_reached") {
        toast.error(`Дневной лимит вопросов исчерпан (${(data as any).limit}/день). Обновите тариф.`);
        return;
      }
      const content = (data as any)?.content || "Не удалось получить ответ.";
      setHistory(h => [...h, { role: "assistant", content, ts: Date.now() }]);
    } catch (e: any) {
      toast.error(e?.message || "Ошибка запроса");
    } finally {
      setLoading(false);
    }
  };

  const clearHistory = () => {
    setHistory([]);
    try { localStorage.removeItem(STORAGE_KEY); } catch { /* ignore */ }
    toast.success("История очищена");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        title="AI-помощник"
        aria-label="AI-помощник"
        className="ai-fab-btn fixed z-40 flex items-center gap-2 text-white font-medium text-sm"
        style={{
          bottom: "24px",
          right: "24px",
          padding: "12px 20px",
          borderRadius: "28px",
          background: "linear-gradient(135deg, #7c3aed, #2563eb)",
          boxShadow: "0 4px 20px rgba(124,58,237,0.4)",
          transition: "transform 0.2s ease",
          animation: "aiFabSlideUp 0.5s ease 2s both",
        }}
      >
        <MessageCircle className="h-5 w-5" />
        <span>AI-помощник</span>
        {!open && (
          <span
            aria-hidden
            style={{
              position: "absolute",
              top: "-2px",
              right: "-2px",
              width: "12px",
              height: "12px",
              borderRadius: "50%",
              background: "#22c55e",
              boxShadow: "0 0 0 2px rgba(255,255,255,0.9)",
              animation: "aiFabPulse 3s ease-in-out infinite",
            }}
          />
        )}
      </button>
      <style>{`
        @keyframes aiFabSlideUp {
          from { opacity: 0; transform: translateY(40px); }
          to { opacity: 1; transform: translateY(0); }
        }
        @keyframes aiFabPulse {
          0%, 100% { transform: scale(1); opacity: 1; box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 0 0 rgba(34,197,94,0.6); }
          50% { transform: scale(1.15); opacity: 0.95; box-shadow: 0 0 0 2px rgba(255,255,255,0.9), 0 0 0 8px rgba(34,197,94,0); }
        }
        .ai-fab-btn:hover { transform: scale(1.05); }
      `}</style>

      <Sheet open={open} onOpenChange={setOpen}>
        <SheetContent side="right" className="w-full sm:max-w-[420px] p-0 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-border">
            <div className="flex items-center gap-2">
              <Sparkles className="h-4 w-4 text-primary" />
              <div className="font-semibold text-sm">AI-помощник по SEO</div>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </div>

          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
            {history.length === 0 && (
              <>
                <div className="rounded-lg bg-muted/50 p-3 text-sm">
                  🤖 Привет! Я помогу разобраться с SEO и функционалом СЕО-Модуля. Задайте любой вопрос!
                </div>
                <div className="space-y-1.5">
                  <div className="text-xs text-muted-foreground">Быстрые вопросы:</div>
                  {QUICK.map((q) => (
                    <button
                      key={q}
                      onClick={() => send(q)}
                      className="w-full text-left text-xs px-3 py-2 rounded-md border border-border hover:bg-muted/40 transition-colors"
                    >
                      {q}
                    </button>
                  ))}
                </div>
              </>
            )}
            {history.map((m, i) => (
              <div key={i} className={cn("flex", m.role === "user" ? "justify-end" : "justify-start")}>
                <div className={cn(
                  "max-w-[85%] rounded-lg px-3 py-2 text-sm",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-muted/50"
                )}>
                  {m.role === "assistant"
                    ? <div className="prose prose-sm dark:prose-invert max-w-none prose-p:my-1 prose-ul:my-1"><ReactMarkdown>{m.content}</ReactMarkdown></div>
                    : <div className="whitespace-pre-wrap">{m.content}</div>}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex items-center gap-2 text-xs text-muted-foreground">
                <Loader2 className="h-3 w-3 animate-spin" /> 🤖 печатает...
              </div>
            )}
          </div>

          <div className="border-t border-border p-3 space-y-2">
            <form
              onSubmit={(e) => { e.preventDefault(); send(input); }}
              className="flex items-center gap-2"
            >
              <input
                value={input}
                onChange={(e) => setInput(e.target.value)}
                placeholder="Задайте вопрос..."
                disabled={loading}
                className="flex-1 rounded-md border border-border bg-background px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-primary"
              />
              <Button type="submit" size="icon" disabled={loading || !input.trim()} className="h-9 w-9">
                <Send className="h-4 w-4" />
              </Button>
            </form>
            {history.length > 0 && (
              <button
                onClick={clearHistory}
                className="flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <Trash2 className="h-3 w-3" /> Очистить историю
              </button>
            )}
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}