import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Bot, MessageSquare, Search, User as UserIcon, Loader2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Conversation {
  id: string;
  user_id: string;
  title: string | null;
  created_at: string;
  updated_at: string;
  email?: string | null;
  message_count?: number;
}

interface Message {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  intent: string | null;
  created_at: string;
}

export function CopilotLogsTab() {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadingMessages, setLoadingMessages] = useState(false);
  const [search, setSearch] = useState("");

  const loadConversations = async () => {
    setLoading(true);
    const { data: convs } = await supabase
      .from("copilot_conversations")
      .select("id, user_id, title, created_at, updated_at")
      .order("updated_at", { ascending: false })
      .limit(200);

    if (!convs) {
      setConversations([]);
      setLoading(false);
      return;
    }

    const userIds = [...new Set(convs.map((c) => c.user_id))];
    const { data: profiles } = await supabase
      .from("profiles")
      .select("id, email")
      .in("id", userIds);

    const emailMap = new Map((profiles ?? []).map((p) => [p.id, p.email]));

    // Count messages per conversation
    const convIds = convs.map((c) => c.id);
    const { data: msgRows } = await supabase
      .from("copilot_messages")
      .select("conversation_id")
      .in("conversation_id", convIds);

    const countMap = new Map<string, number>();
    (msgRows ?? []).forEach((m) => {
      countMap.set(m.conversation_id, (countMap.get(m.conversation_id) ?? 0) + 1);
    });

    setConversations(
      convs.map((c) => ({
        ...c,
        email: emailMap.get(c.user_id) ?? null,
        message_count: countMap.get(c.id) ?? 0,
      }))
    );
    setLoading(false);
  };

  useEffect(() => {
    loadConversations();
  }, []);

  useEffect(() => {
    if (!selectedId) {
      setMessages([]);
      return;
    }
    setLoadingMessages(true);
    supabase
      .from("copilot_messages")
      .select("id, role, content, intent, created_at")
      .eq("conversation_id", selectedId)
      .order("created_at", { ascending: true })
      .then(({ data }) => {
        setMessages((data ?? []) as Message[]);
        setLoadingMessages(false);
      });
  }, [selectedId]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return conversations;
    return conversations.filter(
      (c) =>
        c.title?.toLowerCase().includes(q) ||
        c.email?.toLowerCase().includes(q) ||
        c.user_id.toLowerCase().includes(q)
    );
  }, [conversations, search]);

  const stats = useMemo(() => {
    const totalMessages = conversations.reduce((s, c) => s + (c.message_count ?? 0), 0);
    const uniqueUsers = new Set(conversations.map((c) => c.user_id)).size;
    return { conversations: conversations.length, messages: totalMessages, users: uniqueUsers };
  }, [conversations]);

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Диалогов</div>
            <div className="text-2xl font-mono font-bold">{stats.conversations}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Сообщений</div>
            <div className="text-2xl font-mono font-bold">{stats.messages}</div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="pt-4">
            <div className="text-xs text-muted-foreground">Уникальных пользователей</div>
            <div className="text-2xl font-mono font-bold">{stats.users}</div>
          </CardContent>
        </Card>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[380px_1fr] gap-4">
        {/* Conversations list */}
        <Card className="overflow-hidden">
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <CardTitle className="text-base flex items-center gap-2">
                <MessageSquare className="h-4 w-4" />
                Диалоги
              </CardTitle>
              <Button size="icon" variant="ghost" onClick={loadConversations} className="h-7 w-7">
                <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
              </Button>
            </div>
            <div className="relative">
              <Search className="absolute left-2 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <Input
                placeholder="Поиск по email, теме..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="pl-7 h-8 text-xs"
              />
            </div>
          </CardHeader>
          <CardContent className="p-0">
            <ScrollArea className="h-[560px]">
              {loading ? (
                <div className="flex items-center justify-center py-10">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-10 text-sm text-muted-foreground">
                  Диалогов пока нет
                </div>
              ) : (
                <div className="divide-y divide-border/40">
                  {filtered.map((c) => (
                    <button
                      key={c.id}
                      onClick={() => setSelectedId(c.id)}
                      className={cn(
                        "w-full text-left px-3 py-2.5 hover:bg-muted/40 transition-colors",
                        selectedId === c.id && "bg-muted/60"
                      )}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0 flex-1">
                          <div className="text-xs font-medium truncate">
                            {c.title || "(без темы)"}
                          </div>
                          <div className="flex items-center gap-1.5 mt-0.5">
                            <UserIcon className="h-3 w-3 text-muted-foreground shrink-0" />
                            <span className="text-[10px] text-muted-foreground truncate">
                              {c.email || c.user_id.slice(0, 8)}
                            </span>
                          </div>
                        </div>
                        <Badge variant="secondary" className="text-[10px] h-5 shrink-0">
                          {c.message_count}
                        </Badge>
                      </div>
                      <div className="text-[10px] text-muted-foreground/70 mt-1 font-mono">
                        {new Date(c.updated_at).toLocaleString("ru-RU")}
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>

        {/* Messages viewer */}
        <Card>
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Сообщения</CardTitle>
          </CardHeader>
          <CardContent>
            <ScrollArea className="h-[560px] pr-2">
              {!selectedId ? (
                <div className="text-center py-20 text-sm text-muted-foreground">
                  Выберите диалог слева
                </div>
              ) : loadingMessages ? (
                <div className="flex items-center justify-center py-20">
                  <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
                </div>
              ) : (
                <div className="space-y-3">
                  {messages.map((m) => (
                    <div
                      key={m.id}
                      className={cn(
                        "flex gap-2",
                        m.role === "user" ? "justify-end" : "justify-start"
                      )}
                    >
                      {m.role === "assistant" && (
                        <div className="h-7 w-7 rounded-md bg-amber-500/15 flex items-center justify-center shrink-0">
                          <Bot className="h-3.5 w-3.5 text-amber-400" />
                        </div>
                      )}
                      <div
                        className={cn(
                          "max-w-[80%] rounded-xl px-3 py-2 text-sm whitespace-pre-wrap break-words",
                          m.role === "user"
                            ? "bg-primary/15 text-foreground"
                            : "bg-muted/60 text-foreground"
                        )}
                      >
                        {m.content}
                        <div className="flex items-center gap-2 mt-1.5 pt-1.5 border-t border-border/30">
                          <span className="text-[9px] text-muted-foreground font-mono">
                            {new Date(m.created_at).toLocaleString("ru-RU")}
                          </span>
                          {m.intent && (
                            <Badge variant="outline" className="text-[9px] h-4 px-1.5">
                              {m.intent}
                            </Badge>
                          )}
                        </div>
                      </div>
                      {m.role === "user" && (
                        <div className="h-7 w-7 rounded-md bg-primary/15 flex items-center justify-center shrink-0">
                          <UserIcon className="h-3.5 w-3.5 text-primary" />
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </ScrollArea>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
