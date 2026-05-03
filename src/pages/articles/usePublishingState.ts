import { useState } from "react";
import type { MiralinksLink } from "@/components/article/MiralinksWidget";
import type { GoGetLinksLink } from "@/components/article/GoGetLinksWidget";

/**
 * Изолированный стейт для блока публикации и линкбилдинга.
 * Слабосвязан с генерацией — выносим, чтобы уменьшить ArticlesPage.tsx.
 */
export function usePublishingState() {
  const [publishingTo, setPublishingTo] = useState<string | null>(null);
  const [miralinksLinks, setMiralinksLinks] = useState<MiralinksLink[]>([{ url: "", anchor: "" }]);
  const [miralinksFollowRules, setMiralinksFollowRules] = useState(true);
  const [gogetlinksLinks, setGogetlinksLinks] = useState<GoGetLinksLink[]>([{ url: "", anchor: "" }]);
  const [gogetlinksFollowRules, setGogetlinksFollowRules] = useState(true);
  const [telegraphPath, setTelegraphPath] = useState("");
  const [telegraphUrl, setTelegraphUrl] = useState("");
  const [publishedUrl, setPublishedUrl] = useState("");
  const [anchorLinks, setAnchorLinks] = useState<{ url: string; anchor: string }[]>([
    { url: "", anchor: "" },
  ]);

  return {
    publishingTo, setPublishingTo,
    miralinksLinks, setMiralinksLinks,
    miralinksFollowRules, setMiralinksFollowRules,
    gogetlinksLinks, setGogetlinksLinks,
    gogetlinksFollowRules, setGogetlinksFollowRules,
    telegraphPath, setTelegraphPath,
    telegraphUrl, setTelegraphUrl,
    publishedUrl, setPublishedUrl,
    anchorLinks, setAnchorLinks,
  };
}

/**
 * Изолированный стейт для FAQ / JSON-LD Schema панели.
 */
export function useSchemaFaqState() {
  const [schemaJson, setSchemaJson] = useState<string>("");
  const [schemaCopied, setSchemaCopied] = useState(false);
  const [faqTextBlock, setFaqTextBlock] = useState<string>("");
  const [faqCopied, setFaqCopied] = useState(false);
  const [schemaGenerating, setSchemaGenerating] = useState(false);
  const [faqMode, setFaqMode] = useState<"standard" | "serp-dominance">("serp-dominance");

  return {
    schemaJson, setSchemaJson,
    schemaCopied, setSchemaCopied,
    faqTextBlock, setFaqTextBlock,
    faqCopied, setFaqCopied,
    schemaGenerating, setSchemaGenerating,
    faqMode, setFaqMode,
  };
}