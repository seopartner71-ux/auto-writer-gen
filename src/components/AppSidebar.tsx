import {
  LayoutDashboard,
  Search,
  ListTree,
  FileText,
  BarChart3,
  LineChart as LineChartIcon,
  UserPen,
  Settings,
  ShieldCheck,
  Hexagon,
  FolderKanban,
  CreditCard,
  Radar,
  LifeBuoy,
  Factory,
  Activity,
  Crosshair,
  Send,
  ChevronDown,
  Workflow,
  Sparkles,
  Map,
  PenSquare,
  BookOpen,
  CalendarDays,
  Image as ImageIcon,
  Store,
  MoreHorizontal,
  Link2,
  ClipboardList,
  Wand2,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/shared/hooks/useAuth";
import { useI18n } from "@/shared/hooks/useI18n";
import { PLAN_LIMITS } from "@/shared/api/types";
import { useUnseenChangelog } from "@/shared/hooks/useChangelogNotifier";
import { LATEST_VERSION } from "@/data/changelog";
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarFooter,
  useSidebar,
} from "@/components/ui/sidebar";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import { useCallback, useEffect, useState } from "react";
import { PlanModelCard } from "@/components/sidebar/PlanModelCard";

// Prefetch route chunks on hover
const routePrefetchMap: Record<string, () => void> = {
  "/keywords": () => import("@/pages/KeywordsPage"),
  "/topical-map": () => import("@/pages/TopicalMapPage"),
  "/article-audit": () => import("@/pages/ArticleAuditPage"),
  "/plan-builder": () => import("@/pages/PlanBuilderPage"),
  "/articles": () => import("@/pages/ArticlesPage"),
  "/analytics": () => import("@/pages/AnalyticsPage"),
  "/author-profiles": () => import("@/pages/AuthorProfilesPage"),
  "/settings": () => import("@/pages/SettingsPage"),
  "/pricing": () => import("@/pages/PricingPage"),
  "/indexing": () => import("@/pages/IndexingPage"),
  "/wordpress": () => import("@/pages/WordPressPage"),
  "/radar": () => import("@/pages/RadarPage"),
  "/integrations": () => import("@/pages/IntegrationsPage"),
  "/support": () => import("@/pages/SupportPage"),
  "/admin": () => import("@/pages/AdminPage"),
  "/projects": () => import("@/pages/ProjectsPage"),
  "/site-factory": () => import("@/pages/SiteFactoryPage"),
  "/network-monitor": () => import("@/pages/NetworkMonitorPage"),
  "/domain-hunter": () => import("@/pages/DomainHunterPage"),
  "/rank-tracker": () => import("@/pages/RankTrackerPage"),
  "/vc-writer": () => import("@/pages/VcWriterPage"),
  "/content-plan": () => import("@/pages/ContentPlanPage"),
  "/rewrite": () => import("@/pages/RewritePage"),
};

export function AppSidebar() {
  const { state, setOpenMobile, isMobile } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role, profile } = useAuth();
  const { t, lang } = useI18n();

  const handleNavClick = () => {
    if (isMobile) setOpenMobile(false);
  };

  const handlePrefetch = useCallback((url: string) => {
    routePrefetchMap[url]?.();
  }, []);

  const plan = profile?.plan ?? "free";
  const isFactory = plan === "pro";
  const isBasicOrHigher = plan === "basic" || plan === "pro";
  const isStaffOrAdmin = role === "admin" || role === "staff";

  const networkPaths = ["/site-factory", "/network-monitor", "/domain-hunter"];
  // 3 main groups: Создать / Опубликовать / Аналитика  + collapsed «Ещё».
  const createItems = [
    { title: t("nav.dashboard"), url: "/dashboard", icon: LayoutDashboard },
    { title: t("nav.keywords"), url: "/keywords", icon: Search },
    { title: t("nav.planBuilder"), url: "/plan-builder", icon: ListTree },
    { title: t("nav.articles"), url: "/articles", icon: FileText },
    ...(isBasicOrHigher ? [
      { title: lang === "ru" ? "vc.ru Writer" : "vc.ru Writer", url: "/vc-writer", icon: PenSquare },
    ] : []),
    ...(isStaffOrAdmin ? [
      { title: t("nav.images"), url: "/images", icon: ImageIcon },
      { title: t("nav.commercialPages"), url: "/commercial", icon: Store },
      { title: t("nav.contentPlan"), url: "/content-plan", icon: ClipboardList },
    ] : []),
  ];
  const publishItems = isFactory ? [
    { title: t("nav.wordpress"), url: "/wordpress", icon: Send },
    { title: t("nav.indexing"), url: "/indexing", icon: Send },
    { title: t("nav.integrations"), url: "/integrations", icon: Send },
    { title: t("nav.siteFactory"), url: "/site-factory", icon: Factory },
  ] : [];
  const analyticsItems = [
    { title: t("nav.analytics"), url: "/analytics", icon: BarChart3 },
    { title: t("nav.rankTracker"), url: "/rank-tracker", icon: LineChartIcon },
    ...(isFactory ? [
      { title: "AI Radar", url: "/radar", icon: Radar },
      { title: t("nav.networkMonitor"), url: "/network-monitor", icon: Activity },
      { title: t("nav.domainHunter"), url: "/domain-hunter", icon: Crosshair },
    ] : []),
  ];
  const moreItems = [
    { title: t("nav.projects"), url: "/projects", icon: FolderKanban },
    { title: t("nav.topicalMap"), url: "/topical-map", icon: Map },
    { title: t("nav.articleAudit"), url: "/article-audit", icon: Search },
    { title: t("nav.rewrite"), url: "/rewrite", icon: Wand2 },
    { title: t("nav.authorProfiles"), url: "/author-profiles", icon: UserPen },
    { title: t("nav.calendarPlanner"), url: "/calendar", icon: CalendarDays },
    { title: t("nav.wiki"), url: "/wiki", icon: BookOpen },
    { title: t("nav.utmGenerator"), url: "/utm-generator", icon: Link2 },
    { title: t("nav.pricing"), url: "/pricing", icon: CreditCard },
    { title: t("nav.settings"), url: "/settings", icon: Settings },
    { title: t("nav.support"), url: "/support", icon: LifeBuoy },
  ];
  const publishPaths = publishItems.map(i => i.url);
  const analyticsPaths = analyticsItems.map(i => i.url);
  const morePaths = moreItems.map(i => i.url);
  const [publishOpen, setPublishOpen] = useState(publishPaths.includes(location.pathname));
  const [analyticsOpen, setAnalyticsOpen] = useState(analyticsPaths.includes(location.pathname));
  const [moreOpen, setMoreOpen] = useState(morePaths.includes(location.pathname));

  const unseenChangelog = useUnseenChangelog();
  const APP_VERSION = `v${LATEST_VERSION}`;

  const adminItems = [
    { title: t("nav.admin"), url: "/admin", icon: ShieldCheck },
  ];

  const limits = PLAN_LIMITS[plan as "free" | "basic" | "pro"];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        <div className="flex items-center gap-2 px-4 py-2">
          <Hexagon className="h-6 w-6 text-primary shrink-0" />
          {!collapsed && (
            <span className="text-lg font-brand tracking-tight">{lang === "ru" ? <>СЕО-<span className="gradient-text inline-block whitespace-nowrap">Модуль</span></> : <>SEO-<span className="gradient-text inline-block whitespace-nowrap">Module</span></>}</span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel className="text-sm font-normal">{t("nav.create")}</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {createItems.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                      onClick={handleNavClick}
                      onMouseEnter={() => handlePrefetch(item.url)}
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span className="text-sm">{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {publishItems.length > 0 && (
          <SidebarGroup>
            <Collapsible open={publishOpen} onOpenChange={setPublishOpen}>
              <CollapsibleTrigger asChild>
                <SidebarGroupLabel className="text-sm font-normal cursor-pointer flex items-center justify-between hover:text-primary">
                  <span className="flex items-center gap-2">
                    <Send className="h-4 w-4" />
                    {!collapsed && t("nav.publish")}
                  </span>
                  {!collapsed && <ChevronDown className={`h-4 w-4 transition-transform ${publishOpen ? "" : "-rotate-90"}`} />}
                </SidebarGroupLabel>
              </CollapsibleTrigger>
              <CollapsibleContent>
                <SidebarGroupContent>
                  <SidebarMenu>
                    {publishItems.map((item) => (
                      <SidebarMenuItem key={item.url}>
                        <SidebarMenuButton asChild>
                          <NavLink
                            to={item.url}
                            className="hover:bg-sidebar-accent/50"
                            activeClassName="bg-sidebar-accent text-primary font-medium"
                            onClick={handleNavClick}
                            onMouseEnter={() => handlePrefetch(item.url)}
                          >
                            <item.icon className="mr-2 h-4 w-4 shrink-0" />
                            {!collapsed && <span className="text-sm">{item.title}</span>}
                          </NavLink>
                        </SidebarMenuButton>
                      </SidebarMenuItem>
                    ))}
                  </SidebarMenu>
                </SidebarGroupContent>
              </CollapsibleContent>
            </Collapsible>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <Collapsible open={analyticsOpen} onOpenChange={setAnalyticsOpen}>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="text-sm font-normal cursor-pointer flex items-center justify-between hover:text-primary">
                <span className="flex items-center gap-2">
                  <BarChart3 className="h-4 w-4" />
                  {!collapsed && t("nav.analytics")}
                </span>
                {!collapsed && <ChevronDown className={`h-4 w-4 transition-transform ${analyticsOpen ? "" : "-rotate-90"}`} />}
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {analyticsItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="hover:bg-sidebar-accent/50"
                          activeClassName="bg-sidebar-accent text-primary font-medium"
                          onClick={handleNavClick}
                          onMouseEnter={() => handlePrefetch(item.url)}
                        >
                          <item.icon className="mr-2 h-4 w-4 shrink-0" />
                          {!collapsed && <span className="text-sm">{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>

        <SidebarGroup>
          <Collapsible open={moreOpen} onOpenChange={setMoreOpen}>
            <CollapsibleTrigger asChild>
              <SidebarGroupLabel className="text-sm font-normal cursor-pointer flex items-center justify-between hover:text-primary">
                <span className="flex items-center gap-2">
                  <MoreHorizontal className="h-4 w-4" />
                  {!collapsed && t("nav.more")}
                </span>
                {!collapsed && <ChevronDown className={`h-4 w-4 transition-transform ${moreOpen ? "" : "-rotate-90"}`} />}
              </SidebarGroupLabel>
            </CollapsibleTrigger>
            <CollapsibleContent>
              <SidebarGroupContent>
                <SidebarMenu>
                  {moreItems.map((item) => (
                    <SidebarMenuItem key={item.url}>
                      <SidebarMenuButton asChild>
                        <NavLink
                          to={item.url}
                          className="hover:bg-sidebar-accent/50"
                          activeClassName="bg-sidebar-accent text-primary font-medium"
                          onClick={handleNavClick}
                          onMouseEnter={() => handlePrefetch(item.url)}
                        >
                          <item.icon className="mr-2 h-4 w-4 shrink-0" />
                          {!collapsed && <span className="text-sm">{item.title}</span>}
                        </NavLink>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))}
                </SidebarMenu>
              </SidebarGroupContent>
            </CollapsibleContent>
          </Collapsible>
        </SidebarGroup>

        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel className="text-sm font-normal">{t("nav.administration")}</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.url}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="hover:bg-sidebar-accent/50"
                        activeClassName="bg-sidebar-accent text-primary font-medium"
                        onClick={handleNavClick}
                        onMouseEnter={() => handlePrefetch(item.url)}
                      >
                        <item.icon className="mr-2 h-4 w-4 shrink-0" />
                        {!collapsed && <span className="text-sm">{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}

        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              <SidebarMenuItem>
                <SidebarMenuButton asChild>
                  <NavLink
                    to="/changelog"
                    className="hover:bg-sidebar-accent/50"
                    activeClassName="bg-sidebar-accent text-primary font-medium"
                    onClick={handleNavClick}
                  >
                    <span className="relative mr-2 flex items-center">
                      <Sparkles className="h-4 w-4 shrink-0" />
                      {unseenChangelog && (
                        <span className="absolute -top-0.5 -right-1 h-2 w-2 rounded-full bg-red-500 ring-2 ring-sidebar" />
                      )}
                    </span>
                    {!collapsed && (
                      <span className="flex-1 flex items-center justify-between">
                        <span className="text-sm">{t("nav.changelog")}</span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-primary/15 text-primary font-medium">{APP_VERSION}</span>
                      </span>
                    )}
                  </NavLink>
                </SidebarMenuButton>
              </SidebarMenuItem>
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      {!collapsed && (
        <SidebarFooter>
          <PlanModelCard />
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
