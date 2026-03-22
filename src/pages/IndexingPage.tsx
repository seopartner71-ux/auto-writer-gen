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
import { Separator } from "@/components/ui/separator";
import { Send, Key, CheckCircle2, XCircle, Clock, Loader2, Upload, Zap } from "lucide-react";
import { toast } from "sonner";

export default function IndexingPage() {
  const { user, profile } = useAuth();
  const { t } = useI18n();
  const { isPro } = usePlanLimits();
  const [url, setUrl] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [gscKey, setGscKey] = useState("");
  const [savingKey, setSavingKey] = useState(false);

  // Load logs
  const { data: logs = [], refetch: refetchLogs } = useQuery({
    queryKey: ["indexing-logs"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("indexing_logs")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) throw error;
      return data as any[];
    },
    enabled: isPro,
  });

  // Check if GSC key is configured
  const hasGscKey = !!(profile as any)?.gsc_json_key;

  const handleSaveGscKey = async () => {
    if (!gscKey.trim()) return;
    setSavingKey(true);
    try {
      // Validate JSON
      JSON.parse(gscKey);
      const { error } = await supabase
        .from("profiles")
        .update({ gsc_json_key: gscKey.trim() } as any)
        .eq("id", user!.id);
      if (error) throw error;
      toast.success(t("indexing.keySaved"));
      setGscKey("");
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
      const { data: { session } } = await supabase.auth.getSession();
      if (!session) throw new Error("Not authenticated");

      const resp = await fetch(
        `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/submit-indexing`,
        {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${session.access_token}`,
            apikey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
          },
          body: JSON.stringify({ url: url.trim() }),
        }
      );
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || "Error");

      const successCount = data.results?.filter((r: any) => r.status === "success").length || 0;
      toast.success(`${t("indexing.submitted")} (${successCount}/${data.results?.length || 0})`);
      setUrl("");
      refetchLogs();
    } catch (e: any) {
      toast.error(e.message);
    } finally {
      setSubmitting(false);
    }
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case "success": return <CheckCircle2 className="h-4 w-4 text-green-500" />;
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
                  <Badge variant="default" className="bg-green-600">{t("indexing.configured")}</Badge>
                ) : (
                  <Badge variant="secondary">{t("indexing.notConfigured")}</Badge>
                )}
              </div>
              <div className="space-y-2">
                <Label>{t("indexing.gscJsonKey")}</Label>
                <Textarea
                  value={gscKey}
                  onChange={(e) => setGscKey(e.target.value)}
                  placeholder={t("indexing.gscPlaceholder")}
                  rows={4}
                  className="font-mono text-xs"
                />
              </div>
              <Button onClick={handleSaveGscKey} disabled={savingKey || !gscKey.trim()} size="sm">
                {savingKey ? <Loader2 className="h-4 w-4 animate-spin mr-2" /> : <Upload className="h-4 w-4 mr-2" />}
                {t("indexing.saveKey")}
              </Button>
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
