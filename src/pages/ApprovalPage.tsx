import { useEffect, useState } from "react";
import { useParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { Loader2, CheckCircle2, AlertTriangle, XCircle, Send, Hexagon } from "lucide-react";

type Tab = "blog" | "links" | "trust";
const TABS: { id: Tab; label: string }[] = [
  { id: "blog", label: "Блог" },
  { id: "links", label: "Биржи ссылок" },
  { id: "trust", label: "Трастовые ресурсы" },
];

const STATUS_BORDER: Record<string, string> = {
  ok: "border-emerald-500/60 bg-emerald-500/10",
  rev: "border-amber-500/60 bg-amber-500/10",
  no: "border-red-500/60 bg-red-500/10",
};

interface Topic { id: string; tab: Tab; position: number; title: string; status: "ok" | "rev" | "no" | null; comment: string | null; description?: string | null }
interface ApprovalData {
  plan: { id: string; month: number; year: number; status: string; public_uuid: string; client_responded_at: string | null };
  project: { id: string; name: string; domain: string };
  topics: Topic[];
}

export default function ApprovalPage() {
  const { uuid } = useParams<{ uuid: string }>();
  const [loading, setLoading] = useState(true);
  const [data, setData] = useState<ApprovalData | null>(null);
  const [state, setState] = useState<Record<string, { status: Topic["status"]; comment: string }>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!uuid) return;
      const { data: rpc, error } = await supabase.rpc("get_content_plan_by_uuid", { p_uuid: uuid });
      if (cancelled) return;
      if (error || !rpc) { setLoading(false); return; }
      const payload = rpc as unknown as ApprovalData;
      setData(payload);
      const init: typeof state = {};
      for (const t of payload.topics) init[t.id] = { status: t.status, comment: t.comment ?? "" };
      setState(init);
      if (payload.plan.client_responded_at) setSubmitted(true);
      setLoading(false);
    })();
    return () => { cancelled = true; };
  }, [uuid]);

  const setStatus = (id: string, status: Topic["status"]) =>
    setState((s) => ({ ...s, [id]: { ...(s[id] ?? { status: null, comment: "" }), status } }));
  const setComment = (id: string, comment: string) =>
    setState((s) => ({ ...s, [id]: { ...(s[id] ?? { status: null, comment: "" }), comment } }));

  const submit = async () => {
    if (!data) return;
    const missing = data.topics.find((t) => !state[t.id]?.status);
    if (missing) {
      toast.error("Отметьте статус для всех тем");
      return;
    }
    setSubmitting(true);
    const responses = data.topics.map((t) => ({
      id: t.id, status: state[t.id].status, comment: state[t.id].comment ?? "",
    }));
    const { error } = await supabase.rpc("submit_content_plan_response", { p_uuid: uuid!, p_responses: responses });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    setSubmitted(true);
  };

  if (loading) return <div className="flex items-center justify-center min-h-screen"><Loader2 className="h-6 w-6 animate-spin text-muted-foreground" /></div>;
  if (!data) return (
    <div className="min-h-screen flex items-center justify-center p-6">
      <Card className="max-w-md w-full"><CardContent className="py-10 text-center text-muted-foreground">Ссылка недействительна или план был удалён.</CardContent></Card>
    </div>
  );

  if (submitted) {
    return (
      <div className="min-h-screen flex items-center justify-center p-6 bg-background">
        <Card className="max-w-md w-full text-center">
          <CardHeader>
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mx-auto" />
            <CardTitle className="mt-2">Спасибо!</CardTitle>
            <CardDescription>Ваши комментарии переданы команде.</CardDescription>
          </CardHeader>
        </Card>
      </div>
    );
  }

  const grouped: Record<Tab, Topic[]> = { blog: [], links: [], trust: [] };
  for (const t of data.topics) grouped[t.tab].push(t);

  return (
    <div className="min-h-screen bg-background">
      <header className="border-b border-border">
        <div className="container max-w-4xl py-4 flex items-center gap-2">
          <Hexagon className="h-5 w-5 text-primary" />
          <span className="font-medium">СЕО-Модуль · Контент-план</span>
        </div>
      </header>
      <main className="container max-w-4xl py-8 space-y-6">
        <div>
          <h1 className="text-2xl font-semibold">{data.project.name}</h1>
          <p className="text-sm text-muted-foreground">{data.project.domain} · план на {String(data.plan.month).padStart(2, "0")}/{data.plan.year}</p>
        </div>

        <Tabs defaultValue="blog">
          <TabsList className="grid grid-cols-3 w-full">
            {TABS.map((t) => <TabsTrigger key={t.id} value={t.id}>{t.label} ({grouped[t.id].length})</TabsTrigger>)}
          </TabsList>
          {TABS.map((t) => (
            <TabsContent key={t.id} value={t.id} className="pt-3 space-y-3">
              {grouped[t.id].length === 0 ? (
                <div className="text-sm text-muted-foreground text-center py-6">Тем нет</div>
              ) : grouped[t.id].map((topic) => {
                const cur = state[topic.id] ?? { status: null, comment: "" };
                const cls = cur.status ? STATUS_BORDER[cur.status] : "border-border bg-card";
                return (
                  <div key={topic.id} className={`rounded-lg border p-4 transition-colors ${cls}`}>
                    <div className="mb-3">
                      <div className="text-sm whitespace-pre-wrap">{topic.title}</div>
                      {topic.description && (
                        <div className="mt-1 text-xs text-muted-foreground whitespace-pre-wrap">{topic.description}</div>
                      )}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        size="sm"
                        variant={cur.status === "ok" ? "default" : "outline"}
                        className={cur.status === "ok" ? "bg-emerald-600 hover:bg-emerald-700 text-white" : "border-emerald-500/40 text-emerald-500 hover:bg-emerald-500/10"}
                        onClick={() => setStatus(topic.id, "ok")}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5 mr-1" /> Согласовано
                      </Button>
                      <Button
                        size="sm"
                        variant={cur.status === "rev" ? "default" : "outline"}
                        className={cur.status === "rev" ? "bg-amber-500 hover:bg-amber-600 text-white" : "border-amber-500/40 text-amber-500 hover:bg-amber-500/10"}
                        onClick={() => setStatus(topic.id, "rev")}
                      >
                        <AlertTriangle className="h-3.5 w-3.5 mr-1" /> На доработке
                      </Button>
                      <Button
                        size="sm"
                        variant={cur.status === "no" ? "default" : "outline"}
                        className={cur.status === "no" ? "bg-red-600 hover:bg-red-700 text-white" : "border-red-500/40 text-red-500 hover:bg-red-500/10"}
                        onClick={() => setStatus(topic.id, "no")}
                      >
                        <XCircle className="h-3.5 w-3.5 mr-1" /> Не подходит
                      </Button>
                    </div>
                    {(cur.status === "rev" || cur.status === "no") && (
                      <Textarea
                        value={cur.comment}
                        onChange={(e) => setComment(topic.id, e.target.value)}
                        placeholder="Комментарий — что именно поправить"
                        className="mt-3 min-h-[60px] bg-background/60"
                      />
                    )}
                  </div>
                );
              })}
            </TabsContent>
          ))}
        </Tabs>

        <div className="flex justify-end pt-2">
          <Button onClick={submit} disabled={submitting} size="lg">
            {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
            Отправить ответ
          </Button>
        </div>
      </main>
    </div>
  );
}