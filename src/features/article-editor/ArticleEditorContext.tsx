import { createContext, useContext, useMemo, type MutableRefObject, type ReactNode } from "react";

export type FactCheckStatus = "verified" | "warning" | null;

export interface BenchmarkCacheEntry {
  data: any;
  context: string;
  instructions: string;
}

export interface LsiStatusItem {
  keyword: string;
  found: boolean;
}

export interface ArticleEditorState {
  currentArticleId: string | null;
  isStreaming: boolean;
  setIsStreaming: (v: boolean) => void;
  factCheckStatus: FactCheckStatus;
  setFactCheckStatus: (s: FactCheckStatus) => void;
  lsiStatus: LsiStatusItem[];
  benchmarkCache: MutableRefObject<Map<string, BenchmarkCacheEntry>>;
}

export const ArticleEditorContext = createContext<ArticleEditorState | null>(null);

export function useArticleEditor(): ArticleEditorState {
  const ctx = useContext(ArticleEditorContext);
  if (!ctx) throw new Error("useArticleEditor must be used within ArticleEditorProvider");
  return ctx;
}

interface ProviderProps extends ArticleEditorState {
  children: ReactNode;
}

export function ArticleEditorProvider({ children, ...state }: ProviderProps) {
  // Memoize so consumers don't re-render on unrelated parent renders.
  const value = useMemo<ArticleEditorState>(() => ({
    currentArticleId: state.currentArticleId,
    isStreaming: state.isStreaming,
    setIsStreaming: state.setIsStreaming,
    factCheckStatus: state.factCheckStatus,
    setFactCheckStatus: state.setFactCheckStatus,
    lsiStatus: state.lsiStatus,
    benchmarkCache: state.benchmarkCache,
  }), [
    state.currentArticleId,
    state.isStreaming,
    state.setIsStreaming,
    state.factCheckStatus,
    state.setFactCheckStatus,
    state.lsiStatus,
    state.benchmarkCache,
  ]);
  return <ArticleEditorContext.Provider value={value}>{children}</ArticleEditorContext.Provider>;
}