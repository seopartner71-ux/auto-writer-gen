import { ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiVaultTab } from "@/components/admin/ApiVaultTab";
import { ModelRoutingTab } from "@/components/admin/ModelRoutingTab";
import { HealthCheckTab } from "@/components/admin/HealthCheckTab";
import { UserManagementTab } from "@/components/admin/UserManagementTab";
import { UserContentTab } from "@/components/admin/UserContentTab";
import { FaqManagementTab } from "@/components/admin/FaqManagementTab";
import { PolarSettingsTab } from "@/components/admin/PolarSettingsTab";
import { PlanManagementTab } from "@/components/admin/PlanManagementTab";
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

      <Tabs defaultValue="vault" className="w-full">
        <TabsList className="bg-muted border border-border flex-wrap">
          <TabsTrigger value="vault">API Vault</TabsTrigger>
          <TabsTrigger value="routing">Model Routing</TabsTrigger>
          <TabsTrigger value="health">Health Check</TabsTrigger>
          <TabsTrigger value="users">{t("admin.users")}</TabsTrigger>
          <TabsTrigger value="content">{t("admin.content")}</TabsTrigger>
          <TabsTrigger value="wiki">Wiki / FAQ</TabsTrigger>
          <TabsTrigger value="plans">Тарифы</TabsTrigger>
          <TabsTrigger value="polar">Polar</TabsTrigger>
        </TabsList>

        <TabsContent value="vault" className="mt-4"><ApiVaultTab /></TabsContent>
        <TabsContent value="routing" className="mt-4"><ModelRoutingTab /></TabsContent>
        <TabsContent value="health" className="mt-4"><HealthCheckTab /></TabsContent>
        <TabsContent value="users" className="mt-4"><UserManagementTab /></TabsContent>
        <TabsContent value="content" className="mt-4"><UserContentTab /></TabsContent>
        <TabsContent value="wiki" className="mt-4"><FaqManagementTab /></TabsContent>
        <TabsContent value="plans" className="mt-4"><PlanManagementTab /></TabsContent>
        <TabsContent value="polar" className="mt-4"><PolarSettingsTab /></TabsContent>
      </Tabs>
    </div>
  );
}
