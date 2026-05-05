import { ArticlesPageHeader } from "@/pages/articles/ArticlesPageHeader";

interface HeaderModeSwitcherProps {
  mode: "single" | "bulk";
  onModeChange: (mode: "single" | "bulk") => void;
  hasBulkMode: boolean;
  /** Optional hook to open the sectioned generator sheet. */
  onOpenSectioned?: () => void;
}

/**
 * Thin wrapper around ArticlesPageHeader living under features/article-editor.
 * Provides a stable extraction point for Step 1 of the ArticlesPage refactor
 * without changing existing header markup or behavior.
 */
export function HeaderModeSwitcher({ mode, onModeChange, hasBulkMode }: HeaderModeSwitcherProps) {
  return (
    <ArticlesPageHeader
      mode={mode}
      onModeChange={onModeChange}
      hasBulkMode={hasBulkMode}
    />
  );
}