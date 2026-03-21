import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Route, Routes, Navigate } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/shared/hooks/useAuth";
import { ThemeProvider } from "@/shared/hooks/useTheme";
import { I18nProvider } from "@/shared/hooks/useI18n";
import { ProtectedRoute } from "@/shared/components/ProtectedRoute";
import { AppLayout } from "@/components/AppLayout";

import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import DashboardPage from "@/pages/DashboardPage";
import KeywordsPage from "@/pages/KeywordsPage";
import PlanBuilderPage from "@/pages/PlanBuilderPage";
import ArticlesPage from "@/pages/ArticlesPage";
import CalendarPage from "@/pages/CalendarPage";
import AnalyticsPage from "@/pages/AnalyticsPage";
import AuthorProfilesPage from "@/pages/AuthorProfilesPage";
import SettingsPage from "@/pages/SettingsPage";
import AdminPage from "@/pages/AdminPage";
import NotFound from "@/pages/NotFound";

const queryClient = new QueryClient();

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppLayout>{children}</AppLayout>
    </ProtectedRoute>
  );
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <ThemeProvider>
      <I18nProvider>
        <TooltipProvider>
          <Toaster />
          <Sonner />
          <BrowserRouter>
            <AuthProvider>
              <Routes>
                <Route path="/" element={<Navigate to="/dashboard" replace />} />
                <Route path="/login" element={<LoginPage />} />
                <Route path="/register" element={<RegisterPage />} />

                <Route path="/dashboard" element={<ProtectedLayout><DashboardPage /></ProtectedLayout>} />
                <Route path="/keywords" element={<ProtectedLayout><KeywordsPage /></ProtectedLayout>} />
                <Route path="/plan-builder" element={<ProtectedLayout><PlanBuilderPage /></ProtectedLayout>} />
                <Route path="/articles" element={<ProtectedLayout><ArticlesPage /></ProtectedLayout>} />
                <Route path="/calendar" element={<ProtectedLayout><CalendarPage /></ProtectedLayout>} />
                <Route path="/analytics" element={<ProtectedLayout><AnalyticsPage /></ProtectedLayout>} />
                <Route path="/author-profiles" element={<ProtectedLayout><AuthorProfilesPage /></ProtectedLayout>} />
                <Route path="/settings" element={<ProtectedLayout><SettingsPage /></ProtectedLayout>} />

                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute requiredRole="admin">
                      <AppLayout><AdminPage /></AppLayout>
                    </ProtectedRoute>
                  }
                />

                <Route path="*" element={<NotFound />} />
              </Routes>
            </AuthProvider>
          </BrowserRouter>
        </TooltipProvider>
      </I18nProvider>
    </ThemeProvider>
  </QueryClientProvider>
);

export default App;
