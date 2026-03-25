
# Remove Medium Integration

## Changes

### 1. `src/pages/IntegrationsPage.tsx`
- Remove `mediumToken` state variable
- Remove Medium from `platforms` array
- Remove Medium token from data loading (`useEffect`)
- Remove `medium_token` from `handleSave` update call
- Remove the Medium settings Card (lines 174-194)
- Change grid from `md:grid-cols-3` to `md:grid-cols-2` (only Telegra.ph + Ghost remain)

### 2. `src/pages/ArticlesPage.tsx`
- Remove Medium publish button from the article editor toolbar

### 3. `supabase/functions/publish-medium/index.ts`
- Delete the edge function (or leave as dead code — deleting is cleaner)

### 4. `src/pages/DashboardPage.tsx`
- Remove Medium from publication statistics tracking display
