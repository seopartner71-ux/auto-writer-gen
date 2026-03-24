

## Проблема

Два Supabase-клиента в проекте. `src/shared/api/supabase.ts` — дубликат, который не имеет типизации. Это может привести к несовместимостям и затрудняет автокомплит.

## План: Унифицировать на один клиент

### Шаг 1. Заменить все импорты

В 15 файлах заменить:
```typescript
// Было:
import { supabase } from "@/shared/api/supabase";
// Стало:
import { supabase } from "@/integrations/supabase/client";
```

Файлы для замены:
- `src/shared/hooks/useAuth.tsx`
- `src/pages/KeywordsPage.tsx`
- `src/pages/CalendarPage.tsx`
- `src/pages/DashboardPage.tsx`
- `src/pages/PricingPage.tsx`
- `src/pages/AuthorProfilesPage.tsx`
- `src/pages/PlanBuilderPage.tsx`
- `src/pages/AnalyticsPage.tsx`
- `src/entities/competitor/analysisService.ts`
- `src/components/admin/UserManagementTab.tsx`
- `src/components/admin/ModelRoutingTab.tsx`
- `src/components/admin/ApiVaultTab.tsx`
- `src/components/admin/HealthCheckTab.tsx`
- `src/components/admin/UserContentTab.tsx`
- `src/components/plan/ExpertInsightsBlock.tsx`

### Шаг 2. Удалить дубликат

Удалить файл `src/shared/api/supabase.ts`.

### Результат

- Единый типизированный клиент
- Автокомплит по таблицам и колонкам
- Нет дублирования кода

