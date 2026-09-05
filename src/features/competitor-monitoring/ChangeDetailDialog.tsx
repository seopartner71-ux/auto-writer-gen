import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Sparkles } from "lucide-react";
import { SEVERITY_META, summarizeChange } from "./constants";
import type { ChangeRow } from "./api";

interface Props {
  change: ChangeRow | null;
  pageUrl?: string;
  ru: boolean;
  onOpenChange: (v: boolean) => void;
}

function List({ items, tone }: { items: string[]; tone: "add" | "del" | "plain" }) {
  if (!items?.length) return null;
  const cls = tone === "add"
    ? "bg-emerald-500/10 border-l-2 border-emerald-500/60"
    : tone === "del"
      ? "bg-red-500/10 border-l-2 border-red-500/60 line-through decoration-red-500/50"
      : "bg-muted/40 border-l-2 border-border";
  return (
    <div className="space-y-1">
      {items.slice(0, 40).map((t, i) => (
        <p key={i} className={`text-sm px-3 py-1.5 rounded-sm ${cls}`}>{t}</p>
      ))}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-2">
      <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>
      {children}
    </div>
  );
}

export function ChangeDetailDialog({ change, pageUrl, ru, onOpenChange }: Props) {
  const [mode, setMode] = useState("changes");
  if (!change) return null;

  const diff = (change.diff || {}) as Record<string, any>;
  const sev = SEVERITY_META[change.severity] || SEVERITY_META.low;
  const ai = change.ai_analysis as Record<string, any> | null;
  const meta = diff.meta || {};
  const headings = diff.headings || {};
  const content = diff.content || {};
  const links = diff.links || {};
  const faq = diff.faq || {};

  return (
    <Dialog open={!!change} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex flex-wrap items-center gap-3">
            {ru ? "Изменение страницы" : "Page change"}
            <Badge variant="outline" className={sev.className}>{ru ? sev.ru : sev.en}</Badge>
            <span className="text-sm font-normal text-muted-foreground">
              {new Date(change.detected_at).toLocaleString(ru ? "ru-RU" : "en-GB")}
            </span>
          </DialogTitle>
        </DialogHeader>

        <div className="space-y-5">
          {pageUrl && <p className="text-sm text-muted-foreground break-all">{pageUrl}</p>}

          <Card>
            <CardHeader className="pb-2"><CardTitle className="text-sm">{ru ? "Кратко" : "Summary"}</CardTitle></CardHeader>
            <CardContent className="text-sm">{summarizeChange(change.summary, ru)}</CardContent>
          </Card>

          {ai && (
            <Card className="border-primary/30">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm flex items-center gap-2">
                  <Sparkles className="h-4 w-4 text-primary" /> {ru ? "AI-анализ" : "AI analysis"}
                </CardTitle>
              </CardHeader>
              <CardContent className="space-y-3 text-sm">
                {ai.what_changed && <p><span className="text-muted-foreground">{ru ? "Что изменил конкурент: " : "What changed: "}</span>{ai.what_changed}</p>}
                {ai.probable_goal && <p><span className="text-muted-foreground">{ru ? "Вероятная цель: " : "Probable goal: "}</span>{ai.probable_goal}</p>}
                {ai.what_it_may_mean && <p><span className="text-muted-foreground">{ru ? "Что это может означать: " : "What it may mean: "}</span>{ai.what_it_may_mean}</p>}
                {Array.isArray(ai.what_to_check) && ai.what_to_check.length > 0 && (
                  <div>
                    <p className="text-muted-foreground">{ru ? "Что стоит проверить у нас:" : "What to check on our side:"}</p>
                    <ul className="list-disc pl-5 mt-1 space-y-0.5">
                      {ai.what_to_check.map((x: string, i: number) => <li key={i}>{x}</li>)}
                    </ul>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {(meta.title || meta.description || meta.h1 || meta.canonical || meta.robots) && (
            <Section title="META">
              <div className="space-y-3">
                {["title", "description", "h1", "canonical", "robots"].filter(k => meta[k]).map(k => (
                  <div key={k} className="rounded-md border p-3 space-y-1">
                    <p className="text-xs uppercase text-muted-foreground">{k}</p>
                    <p className="text-sm text-red-400/90">{ru ? "Было: " : "Before: "}{meta[k].before || "-"}</p>
                    <p className="text-sm text-emerald-400/90">{ru ? "Стало: " : "After: "}{meta[k].after || "-"}</p>
                  </div>
                ))}
              </div>
            </Section>
          )}

          {(headings.added?.length || headings.removed?.length || headings.changed?.length) ? (
            <Section title={ru ? "ЗАГОЛОВКИ" : "HEADINGS"}>
              <List items={(headings.added || []).map((h: any) => `${h.level?.toUpperCase?.() || "H"} ${h.text}`)} tone="add" />
              <List items={(headings.removed || []).map((h: any) => `${h.level?.toUpperCase?.() || "H"} ${h.text}`)} tone="del" />
              {(headings.changed || []).map((h: any, i: number) => (
                <p key={i} className="text-sm px-3 py-1.5 rounded-sm bg-muted/40 border-l-2 border-border">
                  {h.before} <span className="text-muted-foreground">-&gt;</span> {h.after}
                </p>
              ))}
            </Section>
          ) : null}

          <Section title={ru ? "КОНТЕНТ" : "CONTENT"}>
            <Tabs value={mode} onValueChange={setMode}>
              <TabsList>
                <TabsTrigger value="changes">{ru ? "Изменения" : "Changes"}</TabsTrigger>
                <TabsTrigger value="before">{ru ? "Было" : "Before"}</TabsTrigger>
                <TabsTrigger value="after">{ru ? "Стало" : "After"}</TabsTrigger>
              </TabsList>
              <TabsContent value="changes" className="pt-3 space-y-3">
                <p className="text-sm text-muted-foreground">
                  {ru ? "Слов было" : "Words before"}: {content.words_before ?? "-"} - {ru ? "стало" : "after"}: {content.words_after ?? "-"}
                </p>
                <List items={content.added || []} tone="add" />
                <List items={content.removed || []} tone="del" />
                {!content.added?.length && !content.removed?.length && (
                  <p className="text-sm text-muted-foreground">{ru ? "Смысловых изменений текста не найдено." : "No meaningful text changes."}</p>
                )}
              </TabsContent>
              <TabsContent value="before" className="pt-3">
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{content.before_text || (ru ? "Нет данных" : "No data")}</p>
              </TabsContent>
              <TabsContent value="after" className="pt-3">
                <p className="text-sm whitespace-pre-wrap text-muted-foreground">{content.after_text || (ru ? "Нет данных" : "No data")}</p>
              </TabsContent>
            </Tabs>
          </Section>

          {(links.internal_added?.length || links.internal_removed?.length || links.external_added?.length || links.external_removed?.length) ? (
            <Section title={ru ? "ССЫЛКИ" : "LINKS"}>
              <List items={links.internal_added || []} tone="add" />
              <List items={links.internal_removed || []} tone="del" />
              <List items={links.external_added || []} tone="add" />
              <List items={links.external_removed || []} tone="del" />
            </Section>
          ) : null}

          {(faq.added?.length || faq.removed?.length) ? (
            <Section title="FAQ">
              <List items={faq.added || []} tone="add" />
              <List items={faq.removed || []} tone="del" />
            </Section>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
