import { DynamicLegalPage } from "@/components/legal/DynamicLegalPage";

export default function CookiesPage() {
  return (
    <DynamicLegalPage
      slug="cookies"
      fallbackTitle="Политика использования Cookie"
      fallback={<CookiesFallback />}
    />
  );
}

function CookiesFallback() {
  return (
    <>
      <p className="text-xs text-muted-foreground/50">Дата вступления в силу: 01.03.2026</p>
      <h2 className="text-lg font-bold text-foreground">1. Что такое Cookie</h2>
      <p>Cookie — небольшие текстовые файлы для запоминания предпочтений и обеспечения корректной работы Сервиса.</p>
      <h2 className="text-lg font-bold text-foreground">2. Типы Cookie</h2>
      <p>Необходимые (сессия), аналитические (Яндекс.Метрика), функциональные (тема, язык).</p>
    </>
  );
}
