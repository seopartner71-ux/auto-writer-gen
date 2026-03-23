import { ShieldCheck } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ApiVaultTab } from "@/components/admin/ApiVaultTab";
import { ModelRoutingTab } from "@/components/admin/ModelRoutingTab";
import { HealthCheckTab } from "@/components/admin/HealthCheckTab";
import { UserManagementTab } from "@/components/admin/UserManagementTab";
import { UserContentTab } from "@/components/admin/UserContentTab";
import { FaqManagementTab } from "@/components/admin/FaqManagementTab";

export default function AdminPage() {
  return (
    <div className="space-y-6">
      <div className="flex items-center gap-3">
        <ShieldCheck className="h-6 w-6 text-primary" />
        <div>
          <h1 className="text-2xl font-semibold">Админ-панель</h1>
          <p className="text-sm text-muted-foreground">
            Управление ключами, моделями и пользователями
          </p>
        </div>
      </div>

      <Tabs defaultValue="vault" className="w-full">
        <TabsList className="bg-muted border border-border">
          <TabsTrigger value="vault">API Vault</TabsTrigger>
          <TabsTrigger value="routing">Model Routing</TabsTrigger>
          <TabsTrigger value="health">Health Check</TabsTrigger>
          <TabsTrigger value="users">Пользователи</TabsTrigger>
          <TabsTrigger value="content">Контент</TabsTrigger>
          <TabsTrigger value="wiki">Wiki / FAQ</TabsTrigger>
        </TabsList>

        <TabsContent value="vault" className="mt-4">
          <ApiVaultTab />
        </TabsContent>

        <TabsContent value="routing" className="mt-4">
          <ModelRoutingTab />
        </TabsContent>

        <TabsContent value="health" className="mt-4">
          <HealthCheckTab />
        </TabsContent>

        <TabsContent value="users" className="mt-4">
          <UserManagementTab />
        </TabsContent>

        <TabsContent value="content" className="mt-4">
          <UserContentTab />
        </TabsContent>
      </Tabs>
    </div>
  );
}
