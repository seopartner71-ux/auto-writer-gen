import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { usePlanLimits } from "@/shared/hooks/usePlanLimits";
import { PlanGate } from "@/shared/components/PlanGate";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Send, Key, CheckCircle2, XCircle, Clock, Loader2, Upload, Zap, FileText, Globe, Copy } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "sonner";

export default function IndexingPage() {
  const { user, profile, refreshProfile } = useAuth();
  const { t, lang } = useI18n();
  const { isPro } = usePlanLimits();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [gscKey, setGscKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);
  const [isReplacingKey, setIsReplacingKey] = useState(false);
  const [gscSiteUrl, setGscSiteUrl] = useState((profile as any)?.gsc_site_url || "");
  const [savingSite, setSavingSite] = useState(false);
  const [selectedUrls, setSelectedUrls] = useState<Record<string, boolean>>({});
  const [bulkSubmitting, setBulkSubmitting] = useState(false);

  const handleSaveSiteUrl = async () => {
    if (!gscSiteUrl.trim()) return;
    setSavingSite(true);
    try {
      const { error } = await supabase
        .from("profiles")
        .update({ gsc_site_url: gscSiteUrl.trim() } as any)
        .eq("id", user!.id);
      if (error) throw error;
      await refreshProfile();
      toast.success(lang === "ru" ? "Адрес сайта сохранён" : "Site URL saved");
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSavingSite(false);
    }
  };

  // Load logs
  const { data: logs = [], refetch: refetchLogs } = useQuery({
    queryKey: ["indexing-logs", user?.id],
    queryFn: async () => {
      if (!user) return [];

      const { data, error } = await supabase
        .from("indexing_logs")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
    enabled: isPro && !!user,
  });

  // Load all published ecosystem documents (landing + PDF URLs) for the user.
  const { data: publishedDocs = [], refetch: refetchPublished } = useQuery({
    queryKey: ["published-ecosystem-docs", user?.id],
    queryFn: async () => {
      if (!user) return [] as Array<{ id: string; title: string; landing_url: string; pdf_url: string | null; deployed_at: string }>;
      const { data, error } = await supabase
        .from("format_deployments")
        .select("id, published_url, deployed_at, ecosystem_formats!inner(id, format_type, pdf_url, metadata, content_ecosystems!inner(user_id, clients(name)))")
        .eq("platform", "github_pages")
        .eq("status", "deployed")
        .eq("ecosystem_formats.content_ecosystems.user_id", user.id)
        .order("deployed_at", { ascending: false })
        .limit(200);
      if (error) throw error;
      return (data || []).map((d: any) => ({
        id: d.id,
        title:
          d?.ecosystem_formats?.metadata?.title ||
          d?.ecosystem_formats?.content_ecosystems?.clients?.name ||
          d?.ecosystem_formats?.format_type ||
          "Документ",
        landing_url: d.published_url,
        pdf_url: d?.ecosystem_formats?.pdf_url || null,
        deployed_at: d.deployed_at,
      }));
    },
    enabled: isPro && !!user,
  });

  const allUrls = publishedDocs.flatMap((d: any) => [d.landing_url, d.pdf_url].filter(Boolean) as string[]);
  const selectedList = allUrls.filter((u) => selectedUrls[u]);
  const toggleUrl = (u: string) => setSelectedUrls((prev) => ({ ...prev, [u]: !prev[u] }));
  const toggleAll = () => {
    if (selectedList.length === allUrls.length) setSelectedUrls({});
    else setSelectedUrls(Object.fromEntries(allUrls.map((u) => [u, true])));
  };

  const copyAll = async () => {
    if (allUrls.length === 0) return;
    try {
      await navigator.clipboard.writeText(allUrls.join("\n"));
      toast.success(lang === "ru" ? `Скопировано ссылок: ${allUrls.length}` : `Copied ${allUrls.length} links`);
    } catch { toast.error("Clipboard error"); }
  };

  const submitBulk = async () => {
    if (selectedList.length === 0) return;
    setBulkSubmitting(true);
    let ok = 0;
    let fail = 0;
    try {
      for (const u of selectedList) {
        try {
          const { data, error } = await supabase.functions.invoke("submit-indexing", { body: { url: u } });
          if (error || data?.error) { fail++; continue; }
          ok++;
        } catch { fail++; }
      }
      toast[fail === 0 ? "success" : "warning" as any]?.(
        lang === "ru"
          ? `Отправлено: ${ok}, ошибок: ${fail}`
          : `Submitted: ${ok}, failed: ${fail}`
      ) ?? toast.success(`OK ${ok} / FAIL ${fail}`);
      setSelectedUrls({});
      await refetchLogs();
    } finally {
      setBulkSubmitting(false);
    }
  };

  // Check if GSC key is configured (use boolean flag, never expose key to client)
  const hasGscKey = !!(profile as any)?.has_gsc_key;

  const handleSaveGscKey = async () => {
    if (!gscKey.trim()) return;
    setSavingKey(true);
    try {
      // Validate JSON
      JSON.parse(gscKey);

      // Encrypt GSC key server-side before saving
      const { data: encData, error: encErr } = await supabase.functions.invoke("encrypt-field", {
        body: { value: gscKey.trim() },
      });
      if (encErr || encData?.error) throw new Error(encData?.error || "Encryption failed");

      const { error } = await supabase
        .from("profiles")
        .update({ gsc_json_key: encData.encrypted } as any)
        .eq("id", user!.id);
      if (error) throw error;
      await refreshProfile();
      toast.success(t("indexing.keySaved"));
      setGscKey("");
      setIsReplacingKey(false);
    } catch (e: any) {
      toast.error(e.message || "Invalid JSON");
    } finally {
      setSavingKey(false);
    }
  };

  const handleSubmitUrl = async () => {
    if (!url.trim()) return;
    setSubmitting(true);
    try {
      const { data, error } = await supabase.functions.invoke("submit-indexing", {
        body: { url: url.trim() },
      });
      if (error) throw error;
      if (data?.error) throw new Error(data.error);

      const successCount = data.results?.filter((r: any) => r.status === "success").length || 0;
      toast.success(`${t("indexing.submitted")} (${successCount}/${data.results?.length || 0})`);
      setUrl("");
      await refetchLogs();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle2 className="h-4 w-4 text-primary" />;
      case "error": return <XCircle className="h-4 w-4 text-destructive" />;
      default: return <Clock className="h-4 w-4 text-muted-foreground" />;
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <Zap className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("indexing.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("indexing.subtitle")}</p>
        </div>
      </div>

      <PlanGate allowed={isPro} featureName={t("indexing.title")} requiredPlan="PRO">
        <div className="grid gap-6 lg:grid-cols-2">
          {/* GSC Key Setup */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Key className="h-5 w-5" />
                {t("indexing.gscSetup")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex items-center gap-2">
                <span className="text-sm text-muted-foreground">{t("indexing.gscStatus")}:</span>
                {hasGscKey ? (
                  <Badge variant="default" className="bg-primary">{t("indexing.configured")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("indexing.notConfigured")}</Badge>
                )}
              </div>
              {hasGscKey && !isReplacingKey ? (
                <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm text-muted-foreground">
                  {lang === "ru"
                    ? "Ключ уже сохранён. Поле ввода откроется только если вы захотите заменить его новым JSON-файлом."
                    : "The key is already saved. Open the input only when you want to replace it with a new JSON file."}
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>{t("indexing.gscJsonKey")}</Label>
                  <Textarea
                    value={gscKey}
                    onChange={(e) => setGscKey(e.target.value)}
                    placeholder={hasGscKey
                      ? (lang === "ru" ? "Вставьте новый JSON-ключ для замены текущего..." : "Paste a new JSON key to replace the current one...")
                      : t("indexing.gscPlaceholder")}
                    rows={4}
                    className="font-mono text-xs"
                  />
                </div>
              )}
              <div className="flex flex-wrap gap-2">
                {hasGscKey && (
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      setIsReplacingKey((current) => {
                        const next = !current;
                        if (!next) setGscKey("");
                        return next;
                      });
                    }}
                  >
                    {isReplacingKey
                      ? (lang === "ru" ? "Отмена" : "Cancel")
                      : (lang === "ru" ? "Заменить ключ" : "Replace key")}
                  </Button>
                )}
                {(!hasGscKey || isReplacingKey) && (
                  <Button onClick={handleSaveGscKey} disabled={savingKey || !gscKey.trim()} size="sm">
                    {savingKey ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                    {t("indexing.saveKey")}
                  </Button>
                )}
              </div>

              {hasGscKey && (
                <div className="pt-3 border-t border-border space-y-2">
                  <Label className="text-xs">
                    {lang === "ru"
                      ? "Адрес сайта в GSC (для отслеживания позиций)"
                      : "GSC site URL (for ranking tracker)"}
                  </Label>
                  <div className="flex gap-2">
                    <Input
                      value={gscSiteUrl}
                      onChange={(e) => setGscSiteUrl(e.target.value)}
                      placeholder="sc-domain:example.com или https://example.com/"
                      className="text-xs"
                    />
                    <Button onClick={handleSaveSiteUrl} disabled={savingSite || !gscSiteUrl.trim()} size="sm" variant="outline">
                      {savingSite ? <Loader2 className="h-4 w-4 animate-spin" /> : (lang === "ru" ? "Сохранить" : "Save")}
                    </Button>
                  </div>
                  <p className="text-[11px] text-muted-foreground">
                    {lang === "ru"
                      ? "Используйте формат как в Search Console: 'sc-domain:example.com' для domain property или 'https://example.com/' для URL-prefix."
                      : "Use exact format from Search Console: 'sc-domain:example.com' or 'https://example.com/'."}
                  </p>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Submit URL */}
          <Card className="bg-card border-border">
            <CardHeader>
              <CardTitle className="text-lg flex items-center gap-2">
                <Send className="h-5 w-5" />
                {t("indexing.submitUrl")}
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <p className="text-sm text-muted-foreground">{t("indexing.submitDesc")}</p>
              <div className="space-y-2">
                <Label>URL</Label>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://example.com/my-article"
                  type="url"
                />
              </div>
              <Button onClick={handleSubmitUrl} disabled={submitting || !url.trim()}>
                {submitting ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Send className="h-4 w-4 mr-2" />}
                {t("indexing.sendToIndex")}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Logs */}
        <Card className="bg-card border-border">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-lg">
              {lang === "ru" ? "Опубликованные документы экосистемы" : "Published ecosystem documents"}
            </CardTitle>
            <div className="flex items-center gap-2">
              <Button size="sm" variant="outline" onClick={copyAll} disabled={allUrls.length === 0}>
                <Copy className="h-4 w-4 mr-1" /> {lang === "ru" ? "Копировать все" : "Copy all"} ({allUrls.length})
              </Button>
              <Button size="sm" onClick={submitBulk} disabled={bulkSubmitting || selectedList.length === 0}>
                {bulkSubmitting ? <Loader2 className="h-4 w-4 mr-1 animate-spin" /> : <Send className="h-4 w-4 mr-1" />}
                {lang === "ru" ? "Отправить выбранные" : "Submit selected"} ({selectedList.length})
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {publishedDocs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                {lang === "ru"
                  ? "Пока нет опубликованных документов. Опубликуйте документ из экосистемы — ссылки появятся здесь автоматически."
                  : "No published documents yet. Publish a document from an ecosystem and its URLs will appear here."}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center gap-2 pb-2 border-b border-border">
                  <Checkbox
                    checked={selectedList.length > 0 && selectedList.length === allUrls.length}
                    onCheckedChange={toggleAll}
                  />
                  <span className="text-xs text-muted-foreground">
                    {lang === "ru" ? "Выбрать все" : "Select all"}
                  </span>
                </div>
                {publishedDocs.map((d: any) => (
                  <div key={d.id} className="rounded border border-border p-2 space-y-1">
                    <div className="text-xs font-medium truncate">{d.title}</div>
                    <div className="flex items-center gap-2 text-xs">
                      <Checkbox checked={!!selectedUrls[d.landing_url]} onCheckedChange={() => toggleUrl(d.landing_url)} />
                      <Globe className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                      <a href={d.landing_url} target="_blank" rel="noreferrer" className="underline truncate">{d.landing_url}</a>
                    </div>
                    {d.pdf_url && (
                      <div className="flex items-center gap-2 text-xs">
                        <Checkbox checked={!!selectedUrls[d.pdf_url]} onCheckedChange={() => toggleUrl(d.pdf_url)} />
                        <FileText className="h-3.5 w-3.5 text-muted-foreground shrink-0" />
                        <a href={d.pdf_url} target="_blank" rel="noreferrer" className="underline truncate">{d.pdf_url}</a>
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Logs */}
        <Card className="bg-card border-border">
          <CardHeader>
            <CardTitle className="text-lg">{t("indexing.logsTitle")}</CardTitle>
          </CardHeader>
          <CardContent>
            {logs.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">{t("indexing.noLogs")}</p>
            ) : (
              <div className="overflow-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t("indexing.colDate")}</TableHead>
                      <TableHead>URL</TableHead>
                      <TableHead>{t("indexing.colProvider")}</TableHead>
                      <TableHead>{t("indexing.colStatus")}</TableHead>
                      <TableHead>{t("indexing.colMessage")}</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {logs.map((log: any) => (
                      <TableRow key={log.id}>
                        <TableCell className="text-xs whitespace-nowrap">
                          {new Date(log.created_at).toLocaleString()}
                        </TableCell>
                        <TableCell className="text-xs max-w-[200px] truncate">{log.url}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {log.provider === "google" ? "Google" : "IndexNow"}
                          </Badge>
                        </TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            {statusIcon(log.status)}
                            <span className="text-xs">{log.status}</span>
                          </div>
                        </TableCell>
                        <TableCell className="text-xs max-w-[250px] truncate text-muted-foreground">
                          {log.response_message}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            )}
          </CardContent>
        </Card>
      </PlanGate>
    </div>
  );
}
