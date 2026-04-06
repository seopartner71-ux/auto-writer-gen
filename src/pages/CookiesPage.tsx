import { LandingNav } from "@/components/landing/LandingNav";
import { LandingFooter } from "@/components/landing/LandingFooter";
import { useI18n } from "@/shared/hooks/useI18n";

export default function CookiesPage() {
  const { lang } = useI18n();

  return (
    <div className="min-h-screen bg-[#050505] text-foreground">
      <LandingNav />
      <div className="container mx-auto px-4 max-w-3xl pt-24 pb-20">
        <h1 className="text-3xl font-black mb-8" style={{ letterSpacing: "-0.04em" }}>
          {lang === "ru" ? "Политика использования файлов Cookie" : "Cookie Policy"}
        </h1>
        <div className="prose prose-invert prose-sm max-w-none space-y-6 text-muted-foreground/80 leading-relaxed">
          <p className="text-xs text-muted-foreground/50">Дата вступления в силу: 01.03.2026</p>

          <h2 className="text-lg font-bold text-foreground">1. Что такое файлы Cookie</h2>
          <p>Файлы cookie — это небольшие текстовые файлы, которые сохраняются на вашем устройстве при посещении нашего сайта. Они позволяют Сервису запоминать ваши предпочтения и обеспечивать корректную работу функционала.</p>

          <h2 className="text-lg font-bold text-foreground">2. Какие файлы Cookie мы используем</h2>

          <h3 className="text-base font-semibold text-foreground/90">2.1. Строго необходимые Cookie</h3>
          <p>Эти файлы необходимы для работы Сервиса. К ним относятся cookie для поддержания сессии авторизации (session tokens), обеспечения безопасности и запоминания выбора языка интерфейса.</p>

          <h3 className="text-base font-semibold text-foreground/90">2.2. Аналитические Cookie</h3>
          <p>Мы используем Яндекс.Метрику для анализа поведения пользователей, оценки эффективности контента и улучшения пользовательского опыта. Яндекс.Метрика собирает обезличенные данные о посещениях, просмотренных страницах, времени на сайте и типе устройства.</p>

          <h3 className="text-base font-semibold text-foreground/90">2.3. Функциональные Cookie</h3>
          <p>Эти cookie запоминают ваши настройки (тему оформления, язык интерфейса, состояние Cookie-баннера) для персонализации взаимодействия с Сервисом.</p>

          <h3 className="text-base font-semibold text-foreground/90">2.4. Рекламные Cookie</h3>
          <p>Могут использоваться для персонализации рекламных материалов. На данный момент Сервис не использует рекламные cookie третьих сторон.</p>

          <h2 className="text-lg font-bold text-foreground">3. Управление файлами Cookie</h2>
          <p>Вы можете управлять файлами cookie через настройки вашего браузера. Обратите внимание: отключение строго необходимых cookie может привести к некорректной работе Сервиса (например, невозможности авторизации).</p>

          <h2 className="text-lg font-bold text-foreground">4. Срок хранения</h2>
          <p>Сессионные cookie удаляются после закрытия браузера. Постоянные cookie хранятся от 30 дней до 1 года в зависимости от назначения.</p>

          <h2 className="text-lg font-bold text-foreground">5. Согласие</h2>
          <p>Продолжая использовать сайт после появления уведомления о cookie, вы соглашаетесь с настоящей Политикой. Вы можете отозвать согласие в любой момент, очистив cookie через настройки браузера.</p>
        </div>
      </div>
      <LandingFooter />
    </div>
  );
}
