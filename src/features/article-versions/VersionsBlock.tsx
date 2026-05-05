import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { History } from "lucide-react";
import { VersionHistoryDialog } from "./VersionHistoryDialog";
import { useArticleVersions } from "./useArticleVersions";

interface VersionsBlockProps {
  articleId: string | null;
  currentContent: string;
  currentTitle?: string;
  onRestoreVersion: (content: string) => void;
  /** Render a button that opens the dialog. Set false to only render the dialog (controlled via event). */
  showButton?: boolean;
}

/**
 * Self-contained Versions block: button + dialog + snapshot logic.
 * Listens to global "open-article-versions" event so other components
 * (QualityBadge, Sidebar) can open it without prop drilling.
 */
export function VersionsBlock({
  articleId,
  currentContent,
  currentTitle,
  onRestoreVersion,
  showButton = true,
}: VersionsBlockProps) {
  const [open, setOpen] = useState(false);
  const { snapshot } = useArticleVersions();

  useEffect(() => {
    const handler = (e: Event) => {
      const detail = (e as CustomEvent).detail;
      if (!detail?.articleId || detail.articleId === articleId) setOpen(true);
    };
    window.addEventListener("open-article-versions", handler);
    return () => window.removeEventListener("open-article-versions", handler);
  }, [articleId]);

  return (
    <>
      {showButton && (
        <Button
          variant="outline"
          size="sm"
          className="h-7 px-2 text-xs gap-1"
          onClick={() => setOpen(true)}
        >
          <History className="w-3 h-3" />
          История
        </Button>
      )}
      <VersionHistoryDialog
        open={open}
        onOpenChange={setOpen}
        articleId={articleId}
        currentContent={currentContent}
        onRestore={(c) => {
          snapshot({
            articleId,
            content: currentContent,
            title: currentTitle || undefined,
            reason: "auto",
          });
          onRestoreVersion(c);
        }}
      />
    </>
  );
}