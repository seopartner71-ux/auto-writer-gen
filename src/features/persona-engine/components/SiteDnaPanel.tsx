import { useState } from "react";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import type { SiteDnaData } from "../types";

const FIELDS: { key: keyof SiteDnaData; label: string; array?: boolean }[] = [
  { key: "brand_name", label: "Название компании" },
  { key: "business_type", label: "Тип бизнеса" },
  { key: "industry", label: "Тематика" },
  { key: "audience", label: "Аудитория" },
  { key: "positioning", label: "Позиционирование" },
  { key: "brand_voice", label: "Tone of Voice" },
  { key: "commercial_context", label: "Коммерческий контекст" },
  { key: "editorial_context", label: "Редакционный контекст" },
  { key: "products", label: "Продукты", array: true },
  { key: "services", label: "Услуги", array: true },
  { key: "expertise_areas", label: "Экспертные направления", array: true },
  { key: "terminology", label: "Терминология", array: true },
  { key: "usp", label: "Преимущества", array: true },
  { key: "restrictions", label: "Коммерческие ограничения", array: true },
  { key: "trust_signals", label: "Сигналы доверия", array: true },
];

interface Props {
  url: string;
  data: SiteDnaData;
  onChange?: (next: SiteDnaData) => void;
  readOnly?: boolean;
}

export function SiteDnaPanel({ url, data, onChange, readOnly }: Props) {
  const [editing, setEditing] = useState(false);
  const editable = Boolean(onChange) && !readOnly;

  const setField = (key: keyof SiteDnaData, value: string, array?: boolean) => {
    if (!onChange) return;
    const next: SiteDnaData = { ...data };
    if (array) {
      next[key] = value.split("\n").map(s => s.trim()).filter(Boolean) as never;
    } else {
      next[key] = (value.trim() || null) as never;
    }
    onChange(next);
  };

  const render = (key: keyof SiteDnaData, array?: boolean) => {
    const v = data[key];
    if (array) {
      const arr = Array.isArray(v) ? (v as string[]) : [];
      return arr.length ? arr.join(", ") : "неизвестно";
    }
    return v ? String(v) : "неизвестно";
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <div className="text-xs text-muted-foreground">Сайт</div>
          <div className="text-sm">{url}</div>
        </div>
        {editable && (
          <Button variant="outline" size="sm" onClick={() => setEditing(e => !e)}>
            {editing ? "Готово" : "Редактировать Site DNA"}
          </Button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        {FIELDS.map(f => (
          <div key={String(f.key)} className="space-y-1">
            <Label className="text-xs text-muted-foreground">{f.label}</Label>
            {editing ? (
              f.array ? (
                <Textarea
                  rows={3}
                  defaultValue={Array.isArray(data[f.key]) ? (data[f.key] as string[]).join("\n") : ""}
                  onBlur={e => setField(f.key, e.target.value, true)}
                  placeholder="По одному пункту в строке"
                />
              ) : (
                <Input
                  defaultValue={data[f.key] ? String(data[f.key]) : ""}
                  onBlur={e => setField(f.key, e.target.value)}
                  placeholder="неизвестно"
                />
              )
            ) : (
              <div className="text-sm">{render(f.key, f.array)}</div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}