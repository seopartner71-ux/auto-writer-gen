import { DynamicLegalPage } from "@/components/legal/DynamicLegalPage";

export default function TermsPage() {
  return (
    <DynamicLegalPage
      slug="terms"
      fallbackTitle="Пользовательское соглашение"
      fallbackTitleEn="Terms of Service"
      fallback={<TermsFallbackRu />}
      fallbackEn={<TermsFallbackEn />}
    />
  );
}

function TermsFallbackRu() {
  return (
    <>
      <p className="text-xs text-muted-foreground/50">Редакция от 01 марта 2026 года</p>

      <h2 className="text-lg font-bold text-foreground">1. Общие условия</h2>
      <p>Настоящее Пользовательское соглашение регулирует отношения между ИП Синицын В. Н. (далее - Оператор) и любым физическим или юридическим лицом, использующим сервис «СЕО-Модуль» (далее - Пользователь). Регистрация на Сервисе означает полное и безоговорочное принятие условий настоящего Соглашения и Политики конфиденциальности.</p>

      <h2 className="text-lg font-bold text-foreground">2. Описание Сервиса</h2>
      <p>«СЕО-Модуль» - SaaS-платформа для генерации SEO-оптимизированного контента с помощью искусственного интеллекта, проведения исследований ключевых слов, аудита и публикации статей. Сервис предоставляется по модели подписки.</p>

      <h2 className="text-lg font-bold text-foreground">3. Регистрация и учетная запись</h2>
      <p>Пользователь обязуется указывать достоверные данные при регистрации, соблюдать конфиденциальность учетных данных, не передавать доступ третьим лицам. Ответственность за действия, совершенные с использованием аккаунта, несет Пользователь.</p>

      <h2 className="text-lg font-bold text-foreground">4. Тарифные планы и оплата</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>NANO - 2 490 ₽ / месяц - 150 кредитов</li>
        <li>PRO - 5 900 ₽ / месяц - 450 кредитов</li>
        <li>FACTORY - 19 900 ₽ / месяц - 1 300 кредитов</li>
      </ul>
      <p>При выборе годовой оплаты применяется скидка 20%. Платежи в рублях проводятся через Prodamus, в долларах США - через Polar. Кредиты не подлежат передаче, неиспользованные кредиты не переносятся на следующий период.</p>

      <h2 className="text-lg font-bold text-foreground">5. Правила использования</h2>
      <p>Запрещается: создание контента, нарушающего законодательство РФ или страны Пользователя, использование Сервиса для спама, фишинга и мошенничества, попытки обхода лимитов и систем безопасности, реверс-инжиниринг и эксплуатация AI-моделей, перепродажа сгенерированного контента в виде автоматизированного сервиса без письменного разрешения.</p>

      <h2 className="text-lg font-bold text-foreground">6. Интеллектуальная собственность</h2>
      <p>Сгенерированный контент принадлежит Пользователю. Все права на платформу, технологии, алгоритмы и интерфейс принадлежат Оператору. Пользователь предоставляет Оператору ограниченную лицензию на использование обезличенных данных для улучшения Сервиса.</p>

      <h2 className="text-lg font-bold text-foreground">7. Возврат средств</h2>
      <p>В силу цифровой природы Сервиса оплаченные подписки возврату не подлежат. В случае технических проблем, препятствующих использованию Сервиса, обратитесь на support@seo-modul.ru в течение 7 дней - вопрос будет рассмотрен индивидуально.</p>

      <h2 className="text-lg font-bold text-foreground">8. Доступность Сервиса</h2>
      <p>Оператор стремится к показателю аптайма 99,9%, но не гарантирует беспрерывную работу. Оператор не несет ответственности за простои, вызванные техническим обслуживанием, действиями третьих сторон или форс-мажорными обстоятельствами.</p>

      <h2 className="text-lg font-bold text-foreground">9. Ограничение ответственности</h2>
      <p>Сервис предоставляется «как есть» без каких-либо гарантий. Оператор не отвечает за косвенные или последовательные убытки. Совокупная ответственность Оператора ограничена суммой, уплаченной Пользователем за 12 месяцев, предшествующих претензии. Оператор не гарантирует достижения конкретных позиций в поисковых системах - алгоритмы Google и Яндекса находятся вне зоны его контроля.</p>

      <h2 className="text-lg font-bold text-foreground">10. Конфиденциальность</h2>
      <p>Обработка персональных данных регулируется Политикой конфиденциальности, размещенной на сайте Сервиса.</p>

      <h2 className="text-lg font-bold text-foreground">11. Расторжение</h2>
      <p>Оператор вправе приостановить или прекратить доступ при нарушении настоящих условий. Пользователь может удалить аккаунт в любое время через настройки. После удаления данные стираются в течение 30 дней.</p>

      <h2 className="text-lg font-bold text-foreground">12. Изменения условий</h2>
      <p>Оператор вправе обновлять Соглашение. Существенные изменения сообщаются через email или внутренние уведомления. Продолжение использования Сервиса после изменений означает их принятие.</p>

      <h2 className="text-lg font-bold text-foreground">13. Контакты</h2>
      <p>ИП Синицын В. Н., ИНН 710302169739. Email: support@seo-modul.ru.</p>
    </>
  );
}

function TermsFallbackEn() {
  return (
    <>
      <p className="text-xs text-muted-foreground/50">Effective date: April 14, 2026</p>

      <h2 className="text-lg font-bold text-foreground">1. Acceptance of Terms</h2>
      <p>By registering for or using SEO-Module ("the Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>

      <h2 className="text-lg font-bold text-foreground">2. Description of Service</h2>
      <p>SEO-Module is an AI-powered platform for generating SEO-optimized articles, conducting keyword research, and managing content strategies. The Service is provided on a subscription basis with plans priced in USD ($).</p>

      <h2 className="text-lg font-bold text-foreground">3. Account Registration</h2>
      <p>You must provide accurate and complete information during registration. You are responsible for maintaining the confidentiality of your credentials and for all activity under your account. Sharing account access with third parties is prohibited.</p>

      <h2 className="text-lg font-bold text-foreground">4. Subscription Plans and Payment</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>NANO: $19/month - 5 credits</li>
        <li>PRO: $79/month - 40 credits</li>
        <li>FACTORY: $249/month - 150 credits</li>
      </ul>
      <p>Payments are processed securely through Polar (card). All prices are in USD. Credits are non-transferable and expire at the end of the billing period unless otherwise stated.</p>

      <h2 className="text-lg font-bold text-foreground">5. Acceptable Use</h2>
      <p>You agree not to:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Generate content that violates applicable laws or regulations</li>
        <li>Use the Service for spam, phishing, or fraudulent purposes</li>
        <li>Attempt to circumvent usage limits or security measures</li>
        <li>Reverse-engineer or exploit the platform's AI models</li>
        <li>Resell generated content as an automated service without written permission</li>
      </ul>

      <h2 className="text-lg font-bold text-foreground">6. Intellectual Property</h2>
      <p>Content generated through the Service belongs to you. However, SEO-Module retains all rights to the platform, its technology, algorithms, and user interface. You grant us a limited license to use anonymized, aggregated usage data to improve the Service.</p>

      <h2 className="text-lg font-bold text-foreground">7. Refund Policy</h2>
      <p>Due to the digital nature of the Service, all payments are final. If you experience technical issues preventing service use, contact support@seo-modul.ru within 7 days of payment for case-by-case resolution.</p>

      <h2 className="text-lg font-bold text-foreground">8. Service Availability</h2>
      <p>We strive for 99.9% uptime but do not guarantee uninterrupted access. We are not liable for downtime caused by maintenance, third-party services, or force majeure events.</p>

      <h2 className="text-lg font-bold text-foreground">9. Limitation of Liability</h2>
      <p>SEO-Module is provided "as is" without warranties of any kind. We are not liable for any indirect, incidental, or consequential damages arising from use of the Service. Our total liability is limited to the amount you paid in the 12 months preceding the claim.</p>

      <h2 className="text-lg font-bold text-foreground">10. Privacy</h2>
      <p>Your use of the Service is also governed by our Privacy Policy, which describes how we collect and process your personal data in compliance with GDPR.</p>

      <h2 className="text-lg font-bold text-foreground">11. Termination</h2>
      <p>We may suspend or terminate your account for violation of these Terms. You may delete your account at any time through Settings. Upon termination, your data will be deleted within 30 days.</p>

      <h2 className="text-lg font-bold text-foreground">12. Changes to Terms</h2>
      <p>We may update these Terms at any time. Material changes will be communicated via email or in-app notification. Continued use after changes constitutes acceptance.</p>

      <h2 className="text-lg font-bold text-foreground">13. Contact</h2>
      <p>For questions about these Terms, contact SEO-Module at support@seo-modul.ru.</p>
    </>
  );
}