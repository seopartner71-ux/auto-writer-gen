import { useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";
import {
  Bot,
  Send,
  Paperclip,
  X,
  Sparkles,
  Activity,
  Zap,
  LifeBuoy,
  BookOpen,
  CheckCircle2,
  AlertTriangle,
  ArrowUpRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { supabase } from "@/integrations/supabase/client";

type WidgetPayload =
  | { kind: "system_check"; api: string; limitUsed: number; limitMax: number; queue: number }
  | { kind: "billing_upsell"; plan: string; price: string }
  | { kind: "support_ticket"; ticketId: string }
  | { kind: "wiki_rag"; source: string };

interface ChatMessage {
  id: string;
  role: "user" | "ai";
  content: string;
  widget?: WidgetPayload;
  createdAt: number;
}

const uid = () => Math.random().toString(36).slice(2, 10);

// Detect which embedded UI card to attach (purely additive — text comes from LLM)
function detectWidget(userText: string): WidgetPayload | undefined {
  const t = userText.toLowerCase();
  if (/(оператор|человек\s*техподдержк|жив(ой|ого)\s*челов|хочу\s*к\s*спе|свяжите|тикет)/.test(t)) {
    return { kind: "support_ticket", ticketId: `T-${Date.now().toString().slice(-6)}` };
  }
  if (/(массов|500\+?\s*стат|тариф\s*factory|апгрейд|upgrade|pro\s*тариф|больше\s*стат)/.test(t)) {
    return { kind: "billing_upsell", plan: "FACTORY", price: "4 990 ₽/мес" };
  }
  if (/(indexing\s*api|квот[аы]|лимит\s*api|google\s*индекс|api\s*не\s*работает)/.test(t)) {
    return { kind: "system_check", api: "Google Indexing API", limitUsed: 187, limitMax: 200, queue: 42 };
  }
  return undefined;
}

async function processUserMessage(
  history: ChatMessage[],
  userText: string
): Promise<{ content: string; widget?: WidgetPayload }> {
  const messages = [
    ...history.map((m) => ({ role: m.role === "ai" ? "assistant" : "user", content: m.content })),
    { role: "user", content: userText },
  ];

  const { data, error } = await supabase.functions.invoke("ai-copilot", { body: { messages } });

  if (error) {
    console.error("[AICopilot] invoke error:", error);
    return {
      content:
        "⚠️ Не удалось связаться с AI. Проверьте подключение или попробуйте позже. Если проблема повторяется — создайте тикет в **/support**.",
    };
  }

  const content =
    (data as { content?: string; error?: string })?.content ||
    (data as { error?: string })?.error ||
    "Пустой ответ от AI.";

  return { content, widget: detectWidget(userText) };
}

// === Embedded UI Cards ===
function SystemCheckCard({ data }: { data: Extract<WidgetPayload, { kind: "system_check" }> }) {
  const pct = Math.round((data.limitUsed / data.limitMax) * 100);
  const critical = pct >= 90;
  return (
    <div className="mt-3 rounded-xl border border-border/60 bg-background/40 p-3 backdrop-blur">
      <div className="flex items-center gap-2 mb-3">
        <Activity className={cn("h-4 w-4", critical ? "text-destructive" : "text-emerald-400")} />
        <span className="text-xs font-semibold text-foreground">{data.api}</span>
        <span
          className={cn(
            "ml-auto text-[10px] px-2 py-0.5 rounded-full font-mono",
            critical ? "bg-destructive/20 text-destructive" : "bg-emerald-500/15 text-emerald-400"
          )}
        >
          {critical ? "CRITICAL" : "OK"}
        </span>
      </div>
      <div className="space-y-2">
        <div>
          <div className="flex justify-between text-[10px] text-muted-foreground mb-1">
            <span>Дневная квота</span>
            <span className="font-mono">
              {data.limitUsed}/{data.limitMax}
            </span>
          </div>
          <div className="h-1.5 rounded-full bg-muted overflow-hidden">
            <div
              className={cn(
                "h-full transition-all",
                critical ? "bg-destructive" : "bg-emerald-400"
              )}
              style={{ width: `${pct}%` }}
            />
          </div>
        </div>
        <div className="flex items-center justify-between text-[10px] pt-1 border-t border-border/40">
          <span className="text-muted-foreground">Очередь задач</span>
          <span className="font-mono text-amber-400">{data.queue} URL pending</span>
        </div>
      </div>
    </div>
  );
}

function BillingUpsellCard({ data }: { data: Extract<WidgetPayload, { kind: "billing_upsell" }> }) {
  return (
    <div className="mt-3 rounded-xl border border-amber-500/30 bg-gradient-to-br from-amber-500/10 to-amber-500/5 p-3">
      <div className="flex items-start gap-2">
        <Zap className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="text-xs font-bold text-amber-200">Тариф {data.plan}</div>
          <div className="text-[11px] text-muted-foreground mb-2">
            500+ статей · CSV bulk · Site Factory · Перелинковка
          </div>
          <div className="flex items-center justify-between gap-2">
            <span className="text-sm font-mono font-bold text-foreground">{data.price}</span>
            <Button
              size="sm"
              className="h-7 text-[11px] bg-amber-500 hover:bg-amber-600 text-amber-950 font-semibold"
              onClick={() => (window.location.href = "/pricing")}
            >
              Апгрейд <ArrowUpRight className="h-3 w-3 ml-1" />
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

function SupportTicketCard({ data }: { data: Extract<WidgetPayload, { kind: "support_ticket" }> }) {
  return (
    <div className="mt-3 rounded-xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 className="h-4 w-4 text-emerald-400" />
        <div className="flex-1">
          <div className="text-xs font-semibold text-emerald-200">Тикет создан</div>
          <div className="text-[10px] text-muted-foreground font-mono">ID: {data.ticketId}</div>
        </div>
        <LifeBuoy className="h-4 w-4 text-emerald-400/60" />
      </div>
    </div>
  );
}

function WikiRagCard({ data }: { data: Extract<WidgetPayload, { kind: "wiki_rag" }> }) {
  return (
    <div className="mt-3 flex items-center gap-2 rounded-lg border border-border/40 bg-muted/30 px-2.5 py-1.5">
      <BookOpen className="h-3 w-3 text-muted-foreground" />
      <span className="text-[10px] font-mono text-muted-foreground truncate">{data.source}</span>
    </div>
  );
}

function renderWidget(widget: WidgetPayload) {
  switch (widget.kind) {
    case "system_check":
      return <SystemCheckCard data={widget} />;
    case "billing_upsell":
      return <BillingUpsellCard data={widget} />;
    case "support_ticket":
      return <SupportTicketCard data={widget} />;
    case "wiki_rag":
      return <WikiRagCard data={widget} />;
  }
}

// === Main Widget ===
export function AICopilotWidget() {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: uid(),
      role: "ai",
      content:
        "👋 Я AI Copilot СЕО-Модуль. Спросите про деплой на Cloudflare Pages, публикацию в Blogger, лимиты API или Stealth-генерацию.",
      createdAt: Date.now(),
    },
  ]);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages, loading]);

  // Ensure a conversation row exists for the current user
  const ensureConversation = async (firstUserText: string): Promise<string | null> => {
    if (conversationId) return conversationId;
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return null;
    const { data, error } = await supabase
      .from("copilot_conversations")
      .insert({
        user_id: auth.user.id,
        title: firstUserText.slice(0, 80),
      })
      .select("id")
      .single();
    if (error || !data) {
      console.error("[AICopilot] conversation create failed:", error);
      return null;
    }
    setConversationId(data.id);
    return data.id;
  };

  const persistMessage = async (
    convId: string,
    role: "user" | "assistant",
    content: string,
    intent?: string
  ) => {
    const { data: auth } = await supabase.auth.getUser();
    if (!auth?.user) return;
    await supabase.from("copilot_messages").insert({
      conversation_id: convId,
      user_id: auth.user.id,
      role,
      content,
      intent: intent ?? null,
    });
  };

  const send = async () => {
    const text = input.trim();
    if (!text || loading) return;
    const userMsg: ChatMessage = { id: uid(), role: "user", content: text, createdAt: Date.now() };
    setMessages((m) => [...m, userMsg]);
    setInput("");
    setLoading(true);

    const convId = await ensureConversation(text);
    if (convId) await persistMessage(convId, "user", text);

    try {
      const reply = await processUserMessage(messages, text);
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "ai",
          content: reply.content,
          widget: reply.widget,
          createdAt: Date.now(),
        },
      ]);
      if (convId) await persistMessage(convId, "assistant", reply.content, reply.widget?.kind);
    } catch {
      setMessages((m) => [
        ...m,
        {
          id: uid(),
          role: "ai",
          content: "⚠️ Ошибка обработки запроса. Попробуйте ещё раз.",
          createdAt: Date.now(),
        },
      ]);
    } finally {
      setLoading(false);
    }
  };

  const suggestions = ["Как задеплоить на Cloudflare?", "Как опубликовать в Blogger?", "Ошибка Indexing API", "Позови оператора"];

  return (
    <>
      {/* Floating button */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          className="fixed bottom-6 right-6 z-50 group flex items-center justify-center h-14 w-14 rounded-full bg-gradient-to-br from-amber-400 to-amber-600 shadow-[0_0_30px_rgba(251,191,36,0.4)] hover:shadow-[0_0_40px_rgba(251,191,36,0.6)] transition-all hover:scale-105"
          aria-label="Открыть AI Copilot"
        >
          <Bot className="h-6 w-6 text-amber-950" strokeWidth={2.5} />
          <span className="absolute -top-1 -right-1 flex h-3 w-3">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500" />
          </span>
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          className="fixed bottom-6 right-6 z-50 flex flex-col rounded-2xl border border-border/60 bg-zinc-950/95 backdrop-blur-xl shadow-2xl shadow-black/50 overflow-hidden animate-in fade-in slide-in-from-bottom-4 duration-200"
          style={{ width: "min(400px, calc(100vw - 3rem))", height: "min(600px, calc(100vh - 3rem))" }}
        >
          {/* Header */}
          <div className="flex items-center gap-3 px-4 py-3 border-b border-border/60 bg-gradient-to-r from-zinc-900 to-zinc-950">
            <div className="relative">
              <div className="h-9 w-9 rounded-lg bg-gradient-to-br from-amber-400 to-amber-600 flex items-center justify-center">
                <Sparkles className="h-4 w-4 text-amber-950" strokeWidth={2.5} />
              </div>
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-sm font-semibold text-foreground truncate">
                AI Copilot <span className="text-muted-foreground font-normal">| СЕО-Модуль</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="relative flex h-2 w-2">
                  <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
                  <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
                </span>
                <span className="text-[10px] text-emerald-400 font-medium">Online · Intent Router v2</span>
              </div>
            </div>
            <button
              onClick={() => setOpen(false)}
              className="h-8 w-8 rounded-lg flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-muted/50 transition-colors"
              aria-label="Закрыть"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4 space-y-4 scroll-smooth">
            {messages.map((msg) => (
              <div
                key={msg.id}
                className={cn("flex", msg.role === "user" ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3.5 py-2.5 text-sm",
                    msg.role === "user"
                      ? "bg-amber-500 text-amber-950 rounded-br-sm font-medium"
                      : "bg-zinc-800/80 text-zinc-100 rounded-bl-sm border border-zinc-700/50"
                  )}
                >
                  {msg.role === "ai" ? (
                    <>
                      <div className="prose prose-sm prose-invert max-w-none prose-p:my-1 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-pre:my-2 prose-pre:bg-zinc-950 prose-pre:text-[11px] prose-code:text-amber-300 prose-code:before:content-none prose-code:after:content-none prose-strong:text-foreground prose-headings:text-foreground">
                        <ReactMarkdown>{msg.content}</ReactMarkdown>
                      </div>
                      {msg.widget && renderWidget(msg.widget)}
                    </>
                  ) : (
                    <span className="whitespace-pre-wrap">{msg.content}</span>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="bg-zinc-800/80 border border-zinc-700/50 rounded-2xl rounded-bl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.3s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce [animation-delay:-0.15s]" />
                  <span className="h-1.5 w-1.5 rounded-full bg-amber-400 animate-bounce" />
                  <span className="text-[10px] text-muted-foreground ml-2 font-mono">routing intent...</span>
                </div>
              </div>
            )}
          </div>

          {/* Suggestions (only when fresh) */}
          {messages.length <= 1 && !loading && (
            <div className="px-4 pb-2 flex flex-wrap gap-1.5">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => setInput(s)}
                  className="text-[10px] px-2 py-1 rounded-full bg-zinc-800/60 border border-zinc-700/50 text-zinc-400 hover:text-amber-300 hover:border-amber-500/40 transition-colors"
                >
                  {s}
                </button>
              ))}
            </div>
          )}

          {/* Input */}
          <div className="border-t border-border/60 bg-zinc-900/60 p-3">
            <div className="flex items-end gap-2 rounded-xl bg-zinc-800/60 border border-zinc-700/50 focus-within:border-amber-500/50 transition-colors px-2 py-1.5">
              <button
                className="h-7 w-7 rounded-md flex items-center justify-center text-muted-foreground hover:text-foreground hover:bg-zinc-700/50 transition-colors shrink-0"
                aria-label="Прикрепить файл"
              >
                <Paperclip className="h-3.5 w-3.5" />
              </button>
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    send();
                  }
                }}
                placeholder="Спросите про SGE, Stealth, индексацию..."
                rows={1}
                className="flex-1 bg-transparent text-sm text-foreground placeholder:text-muted-foreground resize-none outline-none max-h-24 py-1"
              />
              <button
                onClick={send}
                disabled={!input.trim() || loading}
                className="h-7 w-7 rounded-md flex items-center justify-center bg-amber-500 hover:bg-amber-600 disabled:bg-zinc-700 disabled:text-zinc-500 text-amber-950 transition-colors shrink-0"
                aria-label="Отправить"
              >
                <Send className="h-3.5 w-3.5" />
              </button>
            </div>
            <div className="flex items-center justify-between mt-1.5 px-1">
              <span className="text-[9px] text-muted-foreground/60 flex items-center gap-1">
                <AlertTriangle className="h-2.5 w-2.5" />
                AI может ошибаться · проверяйте критичные ответы
              </span>
              <span className="text-[9px] text-muted-foreground/60 font-mono">⏎ send</span>
            </div>
          </div>
        </div>
      )}
    </>
  );
}

export default AICopilotWidget;
