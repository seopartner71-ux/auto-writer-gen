import { DynamicLegalPage } from "@/components/legal/DynamicLegalPage";

export default function PrivacyPage() {
  return (
    <DynamicLegalPage
      slug="privacy"
      fallbackTitle="Политика конфиденциальности"
      fallbackTitleEn="Privacy Policy"
      fallback={<PrivacyFallbackRu />}
      fallbackEn={<PrivacyFallbackEn />}
    />
  );
}

function PrivacyFallbackRu() {
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

function PrivacyFallbackEn() {
  return (
    <>
      <p className="text-xs text-muted-foreground/50">Effective date: April 14, 2026</p>

      <h2 className="text-lg font-bold text-foreground">1. Introduction</h2>
      <p>This Privacy Policy explains how SEO-Module ("we", "us", "our") collects, uses, and protects your personal data in accordance with the General Data Protection Regulation (GDPR) and other applicable data protection laws.</p>

      <h2 className="text-lg font-bold text-foreground">2. Data We Collect</h2>
      <p>We collect the following categories of personal data:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Account information: email address, full name</li>
        <li>Payment data: processed securely through Polar (card payments) and Cryptomus (cryptocurrency), we do not store card details</li>
        <li>Technical data: IP address, browser type, device information, cookies</li>
        <li>Usage data: features used, articles generated, preferences</li>
      </ul>

      <h2 className="text-lg font-bold text-foreground">3. How We Use Your Data</h2>
      <p>We process your personal data for the following purposes:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>To provide and maintain our SEO content generation service</li>
        <li>To process payments and manage subscriptions (in USD)</li>
        <li>To communicate service updates and support responses</li>
        <li>To improve our service through anonymized analytics</li>
        <li>To comply with legal obligations</li>
      </ul>

      <h2 className="text-lg font-bold text-foreground">4. Legal Basis for Processing</h2>
      <p>We process your data based on: (a) your consent, (b) performance of a contract, (c) compliance with legal obligations, and (d) our legitimate interests in improving the service.</p>

      <h2 className="text-lg font-bold text-foreground">5. Data Sharing</h2>
      <p>We do not sell your personal data. We may share data with:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Payment processors (Polar, Cryptomus) for transaction processing</li>
        <li>Cloud infrastructure providers for hosting</li>
        <li>Law enforcement when required by applicable law</li>
      </ul>

      <h2 className="text-lg font-bold text-foreground">6. Your Rights (GDPR)</h2>
      <p>Under GDPR, you have the right to:</p>
      <ul className="list-disc pl-6 space-y-1">
        <li>Access your personal data</li>
        <li>Rectify inaccurate data</li>
        <li>Erase your data ("right to be forgotten")</li>
        <li>Restrict or object to processing</li>
        <li>Data portability</li>
        <li>Withdraw consent at any time</li>
      </ul>
      <p>To exercise any of these rights, contact us at support@seo-modul.ru.</p>

      <h2 className="text-lg font-bold text-foreground">7. Data Retention</h2>
      <p>We retain your personal data for as long as your account is active or as needed to provide services. Upon account deletion, data is removed within 30 days, except where retention is required by law.</p>

      <h2 className="text-lg font-bold text-foreground">8. Cookies</h2>
      <p>We use essential cookies to ensure platform functionality and analytics cookies to improve user experience. You can manage cookie preferences through your browser settings.</p>

      <h2 className="text-lg font-bold text-foreground">9. Security</h2>
      <p>We implement industry-standard security measures including encryption, secure authentication, and regular security audits to protect your data.</p>

      <h2 className="text-lg font-bold text-foreground">10. Contact</h2>
      <p>For any privacy-related inquiries, contact SEO-Module at support@seo-modul.ru.</p>
    </>
  );
}