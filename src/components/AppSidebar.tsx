import {
  LayoutDashboard,
  Search,
  ListTree,
  FileText,
  CalendarDays,
  BarChart3,
  UserPen,
  Settings,
  ShieldCheck,
  KeyRound,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { useLocation } from "react-router-dom";
import { useAuth } from "@/shared/hooks/useAuth";
import { PLAN_LIMITS } from "@/shared/api/types";
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

const mainItems = [
  { title: "Дашборд", url: "/dashboard", icon: LayoutDashboard },
  { title: "Ключевые слова", url: "/keywords", icon: Search },
  { title: "Конструктор плана", url: "/plan-builder", icon: ListTree },
  { title: "Статьи", url: "/articles", icon: FileText },
  { title: "Календарь", url: "/calendar", icon: CalendarDays },
  { title: "Аналитика", url: "/analytics", icon: BarChart3 },
];

const settingsItems = [
  { title: "Профили авторов", url: "/author-profiles", icon: UserPen },
  { title: "Настройки", url: "/settings", icon: Settings },
];

const adminItems = [
  { title: "Админ-панель", url: "/admin", icon: ShieldCheck },
];

export function AppSidebar() {
  const { state } = useSidebar();
  const collapsed = state === "collapsed";
  const location = useLocation();
  const { role, profile } = useAuth();

  const isActive = (path: string) => location.pathname.startsWith(path);
  const plan = profile?.plan ?? "basic";
  const limits = PLAN_LIMITS[plan];

  return (
    <Sidebar collapsible="icon">
      <SidebarContent>
        {/* Logo */}
        <div className="flex items-center gap-2 px-4 py-4">
          <KeyRound className="h-6 w-6 text-primary shrink-0" />
          {!collapsed && (
            <span className="text-lg font-semibold gradient-text">SEO Engine</span>
          )}
        </div>

        <SidebarGroup>
          <SidebarGroupLabel>Основное</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {mainItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      end={item.url === "/dashboard"}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarGroup>
          <SidebarGroupLabel>Инструменты</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {settingsItems.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton asChild>
                    <NavLink
                      to={item.url}
                      className="hover:bg-sidebar-accent/50"
                      activeClassName="bg-sidebar-accent text-primary font-medium"
                    >
                      <item.icon className="mr-2 h-4 w-4 shrink-0" />
                      {!collapsed && <span>{item.title}</span>}
                    </NavLink>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        {role === "admin" && (
          <SidebarGroup>
            <SidebarGroupLabel>Администрирование</SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu>
                {adminItems.map((item) => (
                  <SidebarMenuItem key={item.title}>
                    <SidebarMenuButton asChild>
                      <NavLink
                        to={item.url}
                        className="hover:bg-sidebar-accent/50"
                        activeClassName="bg-sidebar-accent text-primary font-medium"
                      >
                        <item.icon className="mr-2 h-4 w-4 shrink-0" />
                        {!collapsed && <span>{item.title}</span>}
                      </NavLink>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>

      {/* Status bar footer */}
      {!collapsed && (
        <SidebarFooter>
          <div className="px-4 py-3 border-t border-sidebar-border">
            <div className="flex items-center justify-between text-xs text-muted-foreground mb-1">
              <span>Тариф</span>
              <span className="font-medium text-primary uppercase">{plan}</span>
            </div>
            <div className="flex items-center justify-between text-xs text-muted-foreground">
              <span>Лимит</span>
              <span>{limits.maxGenerations} / мес</span>
            </div>
          </div>
        </SidebarFooter>
      )}
    </Sidebar>
  );
}
