import { ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiVaultTab } from "@/components/admin/ApiVaultTab";
import { ModelRoutingTab } from "@/components/admin/ModelRoutingTab";
import { ModelAbTestTab } from "@/components/admin/ModelAbTestTab";
import { AuthorPromptImproverTab } from "@/components/admin/AuthorPromptImproverTab";
import { HealthCheckTab } from "@/components/admin/HealthCheckTab";
import { UserManagementTab } from "@/components/admin/UserManagementTab";
import { RegistrationSettingsTab } from "@/components/admin/RegistrationSettingsTab";
import { UserContentTab } from "@/components/admin/UserContentTab";
import { FaqManagementTab } from "@/components/admin/FaqManagementTab";
import { PolarSettingsTab } from "@/components/admin/PolarSettingsTab";
import { PlanManagementTab } from "@/components/admin/PlanManagementTab";
import { SupportManagementTab } from "@/components/admin/SupportManagementTab";
import { SeoIntegrationsTab } from "@/components/admin/SeoIntegrationsTab";
import { LegalPagesTab } from "@/components/admin/LegalPagesTab";
import { QueueMonitorTab } from "@/components/admin/QueueMonitorTab";
import { PaymentLogsTab } from "@/components/admin/PaymentLogsTab";
import { ErrorLogsTab } from "@/components/admin/ErrorLogsTab";
import { GitHubProjectsTab } from "@/components/admin/GitHubProjectsTab";
import { CopilotLogsTab } from "@/components/admin/CopilotLogsTab";
import { PbnTemplatesTab } from "@/components/admin/PbnTemplatesTab";
import { CostAnalyticsTab } from "@/components/admin/CostAnalyticsTab";
import { PeriodEconomicsTab } from "@/components/admin/PeriodEconomicsTab";
import { CommercialQualityTab } from "@/components/admin/CommercialQualityTab";
import { PipelineHealthTab } from "@/components/admin/PipelineHealthTab";
import { TurgenevAnalyticsTab } from "@/components/admin/TurgenevAnalyticsTab";
import { SemanticInterlinkingTab } from "@/components/admin/SemanticInterlinkingTab";
import { PageVisitsTab } from "@/components/admin/PageVisitsTab";
import { FunnelTab } from "@/components/admin/FunnelTab";
import { TodayKpiCard } from "@/components/admin/TodayKpiCard";
import { TopSpendersCard } from "@/components/admin/TopSpendersCard";
import { OpenRouterBalanceBanner } from "@/components/admin/OpenRouterBalanceBanner";
import { useI18n } from "@/shared/hooks/useI18n";

export default function AdminPage() {
  const { t } = useI18n();

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">{t("admin.title")}</h1>
          <p className="text-sm text-muted-foreground">{t("admin.subtitle")}</p>
        </div>
      </div>

      <OpenRouterBalanceBanner />

      <TodayKpiCard />
      <TopSpendersCard />

      <Tabs defaultValue="vault" className="w-full">
        <TabsList className="bg-muted border border-border flex-wrap h-auto gap-1 p-1 justify-start">
          <TabsTrigger value="vault">API Vault</TabsTrigger>
          <TabsTrigger value="routing">Model Routing</TabsTrigger>
          <TabsTrigger value="abtest">A/B тест</TabsTrigger>
          <TabsTrigger value="prompts">Промпты авторов</TabsTrigger>
          <TabsTrigger value="health">Health Check</TabsTrigger>
          <TabsTrigger value="errors">{t("admin.tabErrors")}</TabsTrigger>
          <TabsTrigger value="users">{t("admin.users")}</TabsTrigger>
          <TabsTrigger value="registration">Регистрация</TabsTrigger>
          <TabsTrigger value="content">{t("admin.content")}</TabsTrigger>
          <TabsTrigger value="wiki">Wiki / FAQ</TabsTrigger>
          <TabsTrigger value="plans">{t("admin.tabPlans")}</TabsTrigger>
          <TabsTrigger value="polar">{t("admin.tabPayments")}</TabsTrigger>
          <TabsTrigger value="support">{t("admin.tabSupport")}</TabsTrigger>
          <TabsTrigger value="seo">SEO</TabsTrigger>
          <TabsTrigger value="legal">{t("admin.tabLegal")}</TabsTrigger>
          <TabsTrigger value="queue">{t("admin.tabQueue")}</TabsTrigger>
          <TabsTrigger value="payments">{t("admin.tabPaymentLogs")}</TabsTrigger>
          <TabsTrigger value="github">GitHub</TabsTrigger>
          <TabsTrigger value="pbn">Шаблоны</TabsTrigger>
          <TabsTrigger value="costs">Расходы</TabsTrigger>
          <TabsTrigger value="economics">Экономика</TabsTrigger>
          <TabsTrigger value="quality">Качество</TabsTrigger>
          <TabsTrigger value="pipeline">Pipeline</TabsTrigger>
          <TabsTrigger value="turgenev">Тургенев</TabsTrigger>
          <TabsTrigger value="semantic">Семантика</TabsTrigger>
          <TabsTrigger value="copilot">Copilot Logs</TabsTrigger>
          <TabsTrigger value="visits">Посещения</TabsTrigger>
          <TabsTrigger value="funnel">{t("admin.tabFunnel")}</TabsTrigger>
        </TabsList>

        <TabsContent value="vault" className="mt-4"><ApiVaultTab /></TabsContent>
        <TabsContent value="routing" className="mt-4"><ModelRoutingTab /></TabsContent>
        <TabsContent value="abtest" className="mt-4"><ModelAbTestTab /></TabsContent>
        <TabsContent value="prompts" className="mt-4"><AuthorPromptImproverTab /></TabsContent>
        <TabsContent value="health" className="mt-4"><HealthCheckTab /></TabsContent>
        <TabsContent value="errors" className="mt-4"><ErrorLogsTab /></TabsContent>
        <TabsContent value="users" className="mt-4"><UserManagementTab /></TabsContent>
        <TabsContent value="registration" className="mt-4"><RegistrationSettingsTab /></TabsContent>
        <TabsContent value="content" className="mt-4"><UserContentTab /></TabsContent>
        <TabsContent value="wiki" className="mt-4"><FaqManagementTab /></TabsContent>
        <TabsContent value="plans" className="mt-4"><PlanManagementTab /></TabsContent>
        <TabsContent value="polar" className="mt-4"><PolarSettingsTab /></TabsContent>
        <TabsContent value="support" className="mt-4"><SupportManagementTab /></TabsContent>
        <TabsContent value="seo" className="mt-4"><SeoIntegrationsTab /></TabsContent>
        <TabsContent value="legal" className="mt-4"><LegalPagesTab /></TabsContent>
        <TabsContent value="queue" className="mt-4"><QueueMonitorTab /></TabsContent>
        <TabsContent value="payments" className="mt-4"><PaymentLogsTab /></TabsContent>
        <TabsContent value="github" className="mt-4"><GitHubProjectsTab /></TabsContent>
        <TabsContent value="pbn" className="mt-4"><PbnTemplatesTab /></TabsContent>
        <TabsContent value="costs" className="mt-4"><CostAnalyticsTab /></TabsContent>
        <TabsContent value="economics" className="mt-4"><PeriodEconomicsTab /></TabsContent>
        <TabsContent value="quality" className="mt-4"><CommercialQualityTab /></TabsContent>
        <TabsContent value="pipeline" className="mt-4"><PipelineHealthTab /></TabsContent>
        <TabsContent value="turgenev" className="mt-4"><TurgenevAnalyticsTab /></TabsContent>
        <TabsContent value="semantic" className="mt-4"><SemanticInterlinkingTab /></TabsContent>
        <TabsContent value="copilot" className="mt-4"><CopilotLogsTab /></TabsContent>
        <TabsContent value="visits" className="mt-4"><PageVisitsTab /></TabsContent>
        <TabsContent value="funnel" className="mt-4"><FunnelTab /></TabsContent>
      </Tabs>
    </div>
  );
}
