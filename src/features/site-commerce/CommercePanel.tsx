import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Store } from "lucide-react";
import { ImportPanel } from "./ImportPanel";
import { KeywordsPanel } from "./KeywordsPanel";
import { ProductsPanel } from "./ProductsPanel";
import { QaPanel } from "./QaPanel";
import { OverviewPanel } from "./OverviewPanel";
import { PdePanel } from "./PdePanel";
import { QualityPanel } from "./QualityPanel";
import { CompanyProfilePanel } from "./CompanyProfilePanel";
import { ContentEnginePanel } from "./ContentEnginePanel";
import { SeoEnginePanel } from "./SeoEnginePanel";
import { CommercialFactorsPanel } from "./CommercialFactorsPanel";

export function CommercePanel({
  projectId, lang, siteName,
}: { projectId: string; lang: string; siteName: string }) {
  const ru = lang === "ru";
  const [kwKey, setKwKey] = useState(0);
  const [prodKey, setProdKey] = useState(0);
  const [tab, setTab] = useState("overview");

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Store className="h-4 w-4" />
          {ru ? "Коммерческий модуль" : "Commercial module"}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <Tabs value={tab} onValueChange={setTab}>
          <TabsList className="mb-4">
            <TabsTrigger value="overview">{ru ? "Обзор" : "Overview"}</TabsTrigger>
            <TabsTrigger value="semantics">{ru ? "Семантика" : "Semantics"}</TabsTrigger>
            <TabsTrigger value="pde">{ru ? "Решения (PDE)" : "Decisions (PDE)"}</TabsTrigger>
            <TabsTrigger value="profile">{ru ? "Профиль" : "Profile"}</TabsTrigger>
            <TabsTrigger value="content">{ru ? "Контент" : "Content"}</TabsTrigger>
            <TabsTrigger value="seo">SEO Engine</TabsTrigger>
            <TabsTrigger value="commercial">{ru ? "Коммерческие факторы" : "Commercial factors"}</TabsTrigger>
            <TabsTrigger value="quality">{ru ? "Качество" : "Quality"}</TabsTrigger>
            <TabsTrigger value="products">{ru ? "Товары и услуги" : "Products"}</TabsTrigger>
            <TabsTrigger value="qa">QA / {ru ? "Экспорт" : "Export"}</TabsTrigger>
          </TabsList>

          <TabsContent value="overview">
            <OverviewPanel projectId={projectId} ru={ru} />
          </TabsContent>

          <TabsContent value="pde">
            <PdePanel projectId={projectId} ru={ru} />
          </TabsContent>

          <TabsContent value="profile">
            <CompanyProfilePanel projectId={projectId} ru={ru} />
          </TabsContent>

          <TabsContent value="content">
            <ContentEnginePanel projectId={projectId} ru={ru} />
          </TabsContent>

          <TabsContent value="seo">
            <SeoEnginePanel projectId={projectId} ru={ru} />
          </TabsContent>

          <TabsContent value="commercial">
            <CommercialFactorsPanel projectId={projectId} ru={ru} onOpenProfile={() => setTab("profile")} />
          </TabsContent>

          <TabsContent value="quality">
            <QualityPanel projectId={projectId} ru={ru} />
          </TabsContent>

          <TabsContent value="semantics" className="space-y-4">
            <ImportPanel projectId={projectId} kind="keywords" ru={ru} onImported={() => setKwKey((k) => k + 1)} />
            <KeywordsPanel
              projectId={projectId}
              ru={ru}
              refreshKey={kwKey}
              onStructureBuilt={() => setProdKey((k) => k + 1)}
            />
          </TabsContent>

          <TabsContent value="products" className="space-y-4">
            <ImportPanel projectId={projectId} kind="products" ru={ru} onImported={() => setProdKey((k) => k + 1)} />
            <ProductsPanel projectId={projectId} ru={ru} refreshKey={prodKey} />
          </TabsContent>

          <TabsContent value="qa">
            <QaPanel projectId={projectId} ru={ru} siteName={siteName} />
          </TabsContent>
        </Tabs>
      </CardContent>
    </Card>
  );
}
