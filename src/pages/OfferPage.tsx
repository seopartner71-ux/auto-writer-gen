import { DynamicLegalPage } from "@/components/legal/DynamicLegalPage";

export default function OfferPage() {
  return (
    <DynamicLegalPage
      slug="offer"
      fallbackTitle="Публичная оферта"
      fallback={<OfferFallback />}
    />
  );
}

function OfferFallback() {
  return (
    <>
      <p className="text-xs text-muted-foreground/50">Дата публикации: 01.03.2026</p>
      <h2 className="text-lg font-bold text-foreground">1. Общие положения</h2>
      <p>Настоящий документ является официальным предложением (публичной офертой) в соответствии со ст. 435 и ч. 2 ст. 437 ГК РФ. Акцептом оферты является совершение оплаты и/или регистрация на платформе «СЕО-Модуль».</p>
      <h2 className="text-lg font-bold text-foreground">2. Предмет договора</h2>
      <p>Исполнитель предоставляет Заказчику доступ к облачному ПО «СЕО-Модуль» для генерации текстового контента с применением технологий ИИ в формате SaaS.</p>
      <h2 className="text-lg font-bold text-foreground">3. Порядок оплаты</h2>
      <p>Оплата производится в рублях РФ. После оплаты начисляются кредиты в соответствии с тарифным планом. Неиспользованные кредиты не переносятся.</p>
    </>
  );
}
