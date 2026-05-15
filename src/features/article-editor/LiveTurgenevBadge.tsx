import { useEffect, useMemo, useState } from "react";
import { Activity } from "lucide-react";
import { estimateTurgenev } from "@/shared/utils/liveTurgenev";

interface Props {
  content: string;
  language?: string;
  visible: boolean;
}

/**
 * Live Anti-Turgenev score shown during streaming.
 * Updates every ~600ms with a client-side approximation. The authoritative
 * score is still computed server-side after save (see QualityCheckPanel).
 */
export function LiveTurgenevBadge({ content, language = "ru", visible }: Props) {
  const [throttled, setThrottled] = useState(content);

  useEffect(() => {
    const id = setTimeout(() => setThrottled(content), 600);
    return () => clearTimeout(id);
  }, [content]);

  const result = useMemo(() => estimateTurgenev(throttled), [throttled]);

  if (!visible || language !== "ru" || !result.enoughText) return null;

  const colorClasses =
    result.band === "ok"
      ? "border-green-500/40 bg-green-500/10 text-green-100"
      : result.band === "warn"
      ? "border-yellow-500/40 bg-yellow-500/10 text-yellow-100"
      : "border-red-500/40 bg-red-500/10 text-red-100";

  const label =
    result.band === "ok"
      ? "Чисто"
      : result.band === "warn"
      ? "Шероховато"
      : "Сильно шумит";

  return (
    <div
      className={`inline-flex items-center gap-2 rounded-md border px-2.5 py-1 text-[11px] ${colorClasses}`}
      title={
        `Live Anti-Turgenev (приблизительно):\n` +
        `Вода: ${result.details.water}/2\n` +
        `Стилистика: ${result.details.style}/2\n` +
        `Повторы: ${result.details.repeats}/2\n` +
        `Переспам: ${result.details.spam}/2\n` +
        `Читаемость: ${result.details.readability}/2\n\n` +
        `Точный расчет - после сохранения статьи.`
      }
    >
      <Activity className="h-3 w-3" />
      <span>Anti-Turgenev: {result.score}/10</span>
      <span className="opacity-70">- {label}</span>
    </div>
  );
}