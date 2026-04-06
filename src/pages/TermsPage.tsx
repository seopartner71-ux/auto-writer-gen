import { DynamicLegalPage } from "@/components/legal/DynamicLegalPage";

export default function TermsPage() {
  return (
    <DynamicLegalPage
      slug="terms"
      fallbackTitle="Пользовательское соглашение"
      fallback={<TermsFallback />}
    />
  );
}

function TermsFallback() {
  return (
    <>
      <p className="text-xs text-muted-foreground/50">Дата вступления в силу: 01.03.2026</p>
      <h2 className="text-lg font-bold text-foreground">1. Общие условия</h2>
      <p>Настоящее Соглашение регулирует отношения между Оператором «СЕО-Модуль» и Пользователем. Регистрация означает согласие с Соглашением.</p>
      <h2 className="text-lg font-bold text-foreground">2. Правила использования</h2>
      <p>Запрещается создание контента, нарушающего законодательство РФ, передача учётных данных третьим лицам.</p>
    </>
  );
}
