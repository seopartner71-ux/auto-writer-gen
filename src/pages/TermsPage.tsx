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
      <p className="text-xs text-muted-foreground/50">Дата вступления в силу: 01.03.2026</p>
      <h2 className="text-lg font-bold text-foreground">1. Общие условия</h2>
      <p>Настоящее Соглашение регулирует отношения между Оператором «СЕО-Модуль» и Пользователем. Регистрация означает согласие с Соглашением.</p>
      <h2 className="text-lg font-bold text-foreground">2. Правила использования</h2>
      <p>Запрещается создание контента, нарушающего законодательство РФ, передача учётных данных третьим лицам.</p>
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
        <li>NANO: $19/month — 5 credits</li>
        <li>PRO: $79/month — 40 credits</li>
        <li>FACTORY: $249/month — 150 credits</li>
      </ul>
      <p>Payments are processed securely through Polar (card) and Cryptomus (cryptocurrency). All prices are in USD. Credits are non-transferable and expire at the end of the billing period unless otherwise stated.</p>

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