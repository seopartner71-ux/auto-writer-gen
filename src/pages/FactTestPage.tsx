import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { runLayer1Rules, type Finding, type FindingSeverity } from "@/lib/factRules";
import { AlertCircle, CheckCircle2, FileSearch } from "lucide-react";

const severityVariant: Record<FindingSeverity, "destructive" | "default" | "secondary"> = {
  critical: "destructive",
  major: "default",
  minor: "secondary",
};

export default function FactTestPage() {
  const [text, setText] = useState("");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [checked, setChecked] = useState(false);

  const handleCheck = () => {
    setFindings(runLayer1Rules(text));
    setChecked(true);
  };

  return (
    <div className="min-h-screen bg-background text-foreground p-6 md:p-10">
      <div className="mx-auto max-w-4xl space-y-6">
        <div className="flex items-center gap-3">
          <FileSearch className="h-6 w-6 text-primary" />
          <h1 className="text-2xl font-semibold tracking-tight">DEV: Layer 1 Fact Check</h1>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="text-base font-medium">Исходный текст</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Вставьте текст статьи..."
              className="min-h-[240px] resize-y font-mono text-sm"
            />
            <div className="flex items-center justify-between">
              <span className="text-sm text-muted-foreground">
                {text.length} символов
              </span>
              <Button onClick={handleCheck}>Проверить</Button>
            </div>
          </CardContent>
        </Card>

        {checked && findings.length === 0 && (
          <div className="flex items-center gap-3 rounded-lg border border-border bg-card p-4 text-card-foreground">
            <CheckCircle2 className="h-5 w-5 text-success" />
            <span>0 находок</span>
          </div>
        )}

        {findings.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2 text-sm text-muted-foreground">
              <AlertCircle className="h-4 w-4" />
              <span>Найдено: {findings.length}</span>
            </div>
            {findings.map((finding, idx) => (
              <Card key={idx}>
                <CardContent className="space-y-3 p-5">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={severityVariant[finding.severity]}>
                      {finding.severity}
                    </Badge>
                    <Badge variant="outline">{finding.type}</Badge>
                  </div>
                  <blockquote className="border-l-2 border-primary pl-3 text-sm italic text-muted-foreground">
                    {finding.quote}
                  </blockquote>
                  <p className="text-sm">{finding.verdict}</p>
                  {finding.suggested_fix && (
                    <p className="text-sm text-muted-foreground">
                      Исправление: {finding.suggested_fix}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
