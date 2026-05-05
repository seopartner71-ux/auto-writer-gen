import { useEffect, useState } from "react";
import { validateContent } from "@/shared/utils/contentValidator";

export type FactCheckStatus = "verified" | "warning" | null;

/**
 * Debounced fact-check hook (Step 3 refactor).
 * Mirrors the original effect that ran a content validator 1s after the user
 * stops typing, skipping while streaming.
 * The setter is exposed so handleGenerate / runFixIssue can override the
 * status synchronously (e.g. clear before stream, mark verified after fix).
 */
export function useFactCheck(content: string, isStreaming: boolean) {
  const [factCheckStatus, setFactCheckStatus] = useState<FactCheckStatus>(null);

  useEffect(() => {
    if (!content || content.length < 100 || isStreaming) {
      return;
    }
    const timer = setTimeout(() => {
      const result = validateContent(content);
      setFactCheckStatus(result.issues.length > 0 ? "warning" : "verified");
    }, 1000);
    return () => clearTimeout(timer);
  }, [content, isStreaming]);

  return { factCheckStatus, setFactCheckStatus };
}