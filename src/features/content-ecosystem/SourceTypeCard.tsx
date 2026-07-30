import { useMemo, useState } from "react";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Loader2, Paperclip, FileText, CheckCircle2, AlertTriangle, ChevronDown } from "lucide-react";
import { ClientPage } from "./types";

export interface ExtractedSource {
  url: string;
  title: string;
  content: string;
  word_count: number;
  fetched_at: string;
}

interface Props {
  typeId: string;
  name: string;
  required: boolean;
  clientPages: ClientPage[];
  mode: "none" | "url";
  onModeChange: (m: "none" | "url") => void;
  urlValue: string;
  onUrlChange: (v: string) => void;
  source?: ExtractedSource;
  extracting: boolean;
  onExtract: () => void;
  onReset: () => void;
}

export function SourceTypeCard({
  typeId, name, required, clientPages, mode, onModeChange,
  urlValue, onUrlChange, source, extracting, onExtract, onReset,
}: Props) {
  const [showAll, setShowAll] = useState(false);

  const suggestions = useMemo(() => {
    const q = urlValue.trim().toLowerCase();
    const list = showAll || !q
      ? clientPages
      : clientPages.filter(p =>
          p.url.toLowerCase().includes(q) || p.title.toLowerCase().includes(q));
    return list.slice(0, 8);
  }, [clientPages, urlValue, showAll]);

  const showSuggestions = mode === "url" && !source && suggestions.length > 0 &&
    (showAll || (urlValue.trim().length > 0 && urlValue.trim() !== source?.url));

  return (
    <div className="p-3 border rounded space-y-3">
      <div className="flex items-start gap-2">
        <Paperclip className="h-4 w-4 mt-0.5 text-primary shrink-0" />
        <div className="space-y-1">
          <div className="text-sm font-medium flex items-center gap-2">
            {name}
            {required ? (
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-destructive/10 text-destructive">обязателен</span>
            ) : (
              <span className="text-[10px] uppercase px-1.5 py-0.5 rounded bg-muted text-muted-foreground">рекомендуется</span>
            )}
          </div>
          <div className="text-xs text-muted-foreground">
            Модель будет использовать данные с указанной страницы для генерации точных названий и характеристик
          </div>
        </div>
      </div>

      <RadioGroup value={mode} onValueChange={(v) => onModeChange(v as "none" | "url")} className="space-y-1">
        <div className="flex items-center gap-2">
          <RadioGroupItem value="none" id={`none-${typeId}`} />
          <Label htmlFor={`none-${typeId}`} className="text-xs font-normal cursor-pointer">
            Без источника (модель использует общие формулировки)
          </Label>
        </div>
        <div className="flex items-center gap-2">
          <RadioGroupItem value="url" id={`url-${typeId}`} />
          <Label htmlFor={`url-${typeId}`} className="text-xs font-normal cursor-pointer">
            Указать URL страницы клиента
          </Label>
        </div>
      </RadioGroup>

      {mode === "none" && !required && (
        <div className="flex items-start gap-2 text-xs text-muted-foreground">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Без источника модель будет использовать общие формулировки - качество может быть ниже
        </div>
      )}
      {mode === "none" && required && (
        <div className="flex items-start gap-2 text-xs text-destructive">
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          Для этого типа документа необходим источник
        </div>
      )}

      {mode === "url" && !source && (
        <div className="space-y-2">
          <div className="flex gap-2">
            <div className="relative flex-1">
              <Input
                placeholder="https://site.ru/catalog/"
                value={urlValue}
                onChange={e => { setShowAll(false); onUrlChange(e.target.value); }}
              />
              {clientPages.length > 0 && (
                <button
                  type="button"
                  onClick={() => setShowAll(v => !v)}
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  aria-label="Показать все страницы клиента"
                >
                  <ChevronDown className="h-4 w-4" />
                </button>
              )}
            </div>
            <Button variant="outline" onClick={onExtract} disabled={extracting || !urlValue.trim()}>
              {extracting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Проверить и извлечь
            </Button>
          </div>
          {clientPages.length === 0 && (
            <div className="text-[11px] text-muted-foreground">
              У клиента нет сохранённых страниц - введите URL вручную
            </div>
          )}
          {showSuggestions && (
            <div className="border rounded divide-y max-h-48 overflow-y-auto">
              {suggestions.map(p => (
                <button
                  key={p.id}
                  type="button"
                  onClick={() => { onUrlChange(p.url); setShowAll(false); }}
                  className="w-full text-left p-2 hover:bg-accent"
                >
                  <div className="text-xs font-medium truncate">{p.title || p.url}</div>
                  <div className="text-[11px] text-muted-foreground truncate">{p.url}</div>
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {mode === "url" && source && (
        <div className="p-2 rounded bg-muted/40 text-xs space-y-1">
          <div className="flex items-center gap-1.5 text-primary">
            <CheckCircle2 className="h-3.5 w-3.5" />
            <span className="font-medium">Извлечено: {source.title}</span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <FileText className="h-3.5 w-3.5" />
            {source.word_count} слов · {new Date(source.fetched_at).toLocaleDateString("ru-RU")}
          </div>
          <div className="text-muted-foreground break-all">{source.url}</div>
          <div className="text-muted-foreground line-clamp-4">
            {source.content.split(/\s+/).slice(0, 200).join(" ")}
          </div>
          <Button variant="ghost" size="sm" className="h-7 px-2" onClick={onReset}>Изменить URL</Button>
        </div>
      )}
    </div>
  );
}