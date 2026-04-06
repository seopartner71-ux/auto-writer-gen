import { DynamicLegalPage } from "@/components/legal/DynamicLegalPage";

export default function PrivacyPage() {
  return (
    <DynamicLegalPage
      slug="privacy"
      fallbackTitle="Политика конфиденциальности"
      fallback={<PrivacyFallback />}
    />
  );
}

function PrivacyFallback() {
  return (
    <>
      <p className="text-xs text-muted-foreground/50">Дата вступления в силу: 01.03.2026</p>
      <h2 className="text-lg font-bold text-foreground">1. Общие положения</h2>
      <p>Настоящая Политика разработана в соответствии с ФЗ-152 «О персональных данных» и определяет порядок обработки персональных данных пользователей «СЕО-Модуль».</p>
      <h2 className="text-lg font-bold text-foreground">2. Собираемые данные</h2>
      <p>Email, имя, данные о платежах (через Polar), техническая информация (IP, cookie).</p>
    </>
  );
}
