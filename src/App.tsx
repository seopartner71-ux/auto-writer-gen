import { lazy, Suspense } from "react";
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
import { Loader2 } from "lucide-react";

// Eagerly loaded (core pages)
import LoginPage from "@/pages/LoginPage";
import RegisterPage from "@/pages/RegisterPage";
import DashboardPage from "@/pages/DashboardPage";
import KeywordsPage from "@/pages/KeywordsPage";
import NotFound from "@/pages/NotFound";

// Lazy loaded (heavy / less frequent pages)
const PlanBuilderPage = lazy(() => import("@/pages/PlanBuilderPage"));
const ArticlesPage = lazy(() => import("@/pages/ArticlesPage"));
const CalendarPage = lazy(() => import("@/pages/CalendarPage"));
const AnalyticsPage = lazy(() => import("@/pages/AnalyticsPage"));
const AuthorProfilesPage = lazy(() => import("@/pages/AuthorProfilesPage"));
const SettingsPage = lazy(() => import("@/pages/SettingsPage"));
const AdminPage = lazy(() => import("@/pages/AdminPage"));
const PricingPage = lazy(() => import("@/pages/PricingPage"));
const IndexingPage = lazy(() => import("@/pages/IndexingPage"));
const WordPressPage = lazy(() => import("@/pages/WordPressPage"));

const queryClient = new QueryClient();

function PageLoader() {
  return (
    <div className="flex items-center justify-center py-20">
      <Loader2 className="h-6 w-6 animate-spin text-primary" />
    </div>
  );
}

function ProtectedLayout({ children }: { children: React.ReactNode }) {
  return (
    <ProtectedRoute>
      <AppLayout>
        <Suspense fallback={<PageLoader />}>
          {children}
        </Suspense>
      </AppLayout>
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
                <Route path="/pricing" element={<ProtectedLayout><PricingPage /></ProtectedLayout>} />
                <Route path="/indexing" element={<ProtectedLayout><IndexingPage /></ProtectedLayout>} />
                <Route path="/wordpress" element={<ProtectedLayout><WordPressPage /></ProtectedLayout>} />

                <Route
                  path="/admin"
                  element={
                    <ProtectedRoute requiredRole="admin">
                      <AppLayout>
                        <Suspense fallback={<PageLoader />}>
                          <AdminPage />
                        </Suspense>
                      </AppLayout>
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
