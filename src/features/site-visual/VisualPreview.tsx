// P17 Visual Engine - wireframe preview of the visual JSON before publishing.
// Renders the block skeleton of a page with the design profile tokens.
// This is a preview only: the site build is not touched.

import { useMemo } from "react";
import { BLOCK_LABEL, PREVIEW_FALLBACK, type DesignProfileRow, type VisualBlockConfig } from "./catalog";

export type PreviewDevice = "desktop" | "tablet" | "mobile";

const DEVICE_WIDTH: Record<PreviewDevice, number> = { desktop: 1280, tablet: 834, mobile: 390 };

interface Props {
  profile: DesignProfileRow;
  pageType: string;
  blocks?: VisualBlockConfig[];
  device: PreviewDevice;
  ru: boolean;
}

function label(type: string, ru: boolean) {
  return BLOCK_LABEL[type]?.[ru ? "ru" : "en"] || type;
}

/** A tiny visual sketch per block group so the preview reads like a page. */
function BlockSketch({ type, profile, cols }: { type: string; profile: DesignProfileRow; cols: number }) {
  const c = profile.color_scheme;
  const bar = (w: string, h = 10, bg = c.muted, o = 0.35) => (
    <div style={{ width: w, height: h, background: bg, opacity: o, borderRadius: 4 }} />
  );

  if (type === "header") {
    return (
      <div style={{ display: "flex", alignItems: "center", gap: 12, justifyContent: "space-between" }}>
        <div style={{ fontWeight: 700, color: c.primary, fontSize: 14 }}>
          {profile.components_config?.logo_text || "LOGO"}
        </div>
        <div style={{ display: "flex", gap: 8 }}>{[0, 1, 2, 3].map((i) => bar("46px", 8))}</div>
        <div style={{ background: c.accent, color: "#fff", borderRadius: 6, padding: "6px 10px", fontSize: 11 }}>CTA</div>
      </div>
    );
  }
  if (type.startsWith("hero")) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: cols > 1 ? "1.2fr 1fr" : "1fr", gap: 14, alignItems: "center" }}>
        <div style={{ display: "grid", gap: 8 }}>
          {bar("80%", 18, c.text, 0.8)}
          {bar("95%", 8)}
          {bar("70%", 8)}
          <div style={{ background: c.primary, color: "#fff", borderRadius: 6, padding: "8px 14px", fontSize: 11, width: "fit-content" }}>
            {profile.components_config?.logo_text ? "Оставить заявку" : "CTA"}
          </div>
        </div>
        <div style={{ height: 96, background: c.surface, borderRadius: 8, border: `1px solid ${c.muted}33` }} />
      </div>
    );
  }
  if (["products", "categories", "subcategories", "related_products", "cases", "articles", "certificates", "brands", "reviews", "advantages", "trust"].includes(type)) {
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${cols}, 1fr)`, gap: 10 }}>
        {Array.from({ length: cols * 2 }).map((_, i) => (
          <div key={i} style={{ background: c.surface, border: `1px solid ${c.muted}22`, borderRadius: 8, padding: 10, display: "grid", gap: 6 }}>
            <div style={{ height: 34, background: `${c.muted}22`, borderRadius: 6 }} />
            {bar("80%", 8)}
            {bar("55%", 8, c.accent, 0.5)}
          </div>
        ))}
      </div>
    );
  }
  if (["characteristics", "comparison", "delivery", "payment", "price"].includes(type)) {
    return (
      <div style={{ border: `1px solid ${c.muted}33`, borderRadius: 8, overflow: "hidden" }}>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} style={{ display: "flex", gap: 12, padding: "7px 10px", background: i % 2 ? c.surface : "transparent" }}>
            {bar("40%", 8)}
            {bar("30%", 8, c.text, 0.5)}
          </div>
        ))}
      </div>
    );
  }
  if (type === "faq") {
    return (
      <div style={{ display: "grid", gap: 6 }}>
        {[0, 1, 2].map((i) => (
          <div key={i} style={{ border: `1px solid ${c.muted}33`, borderRadius: 6, padding: "8px 10px", display: "flex", justifyContent: "space-between" }}>
            {bar("60%", 8, c.text, 0.6)}
            <span style={{ color: c.muted, fontSize: 12 }}>+</span>
          </div>
        ))}
      </div>
    );
  }
  if (["cta", "lead_form", "callback"].includes(type)) {
    return (
      <div style={{ background: c.primary, borderRadius: 10, padding: 14, display: "grid", gap: 8 }}>
        {bar("50%", 12, "#ffffff", 0.9)}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <div style={{ flex: 1, minWidth: 90, height: 28, background: "#ffffff", opacity: 0.9, borderRadius: 6 }} />
          <div style={{ background: c.accent, color: "#fff", borderRadius: 6, padding: "6px 14px", fontSize: 11 }}>OK</div>
        </div>
      </div>
    );
  }
  if (type === "footer") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(cols, 4)}, 1fr)`, gap: 10 }}>
        {Array.from({ length: Math.min(cols, 4) }).map((_, i) => (
          <div key={i} style={{ display: "grid", gap: 6 }}>
            {bar("60%", 8, c.text, 0.6)}
            {bar("80%", 6)}
            {bar("70%", 6)}
          </div>
        ))}
      </div>
    );
  }
  if (type === "breadcrumb") {
    return <div style={{ display: "flex", gap: 6, alignItems: "center", color: c.muted, fontSize: 11 }}>Главная / Раздел / Страница</div>;
  }
  if (type === "gallery") {
    return (
      <div style={{ display: "grid", gridTemplateColumns: `repeat(${Math.min(cols, 4)}, 1fr)`, gap: 8 }}>
        {Array.from({ length: Math.min(cols, 4) }).map((_, i) => (
          <div key={i} style={{ height: 60, background: c.surface, border: `1px solid ${c.muted}22`, borderRadius: 6 }} />
        ))}
      </div>
    );
  }
  return (
    <div style={{ display: "grid", gap: 6 }}>
      {bar("95%", 8)}
      {bar("88%", 8)}
      {bar("62%", 8)}
    </div>
  );
}

export function VisualPreview({ profile, pageType, blocks, device, ru }: Props) {
  const list = useMemo(() => {
    const source = (blocks && blocks.length ? blocks : (PREVIEW_FALLBACK[pageType] || PREVIEW_FALLBACK.home).map((type, order) => ({ type, enabled: true, order })));
    return [...source].filter((b) => b.enabled !== false).sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
  }, [blocks, pageType]);

  const c = profile.color_scheme;
  const cols = device === "mobile" ? 1 : device === "tablet" ? 2 : 3;
  const width = DEVICE_WIDTH[device];
  const pad = device === "mobile" ? 12 : 24;

  return (
    <div className="w-full overflow-x-auto rounded-md border bg-muted/20 p-3">
      <div
        className="mx-auto origin-top"
        style={{
          width,
          maxWidth: "100%",
          background: c.background,
          color: c.text,
          fontFamily: `"${profile.typography.body_font}", system-ui, sans-serif`,
          borderRadius: 10,
          border: `1px solid ${c.muted}33`,
          overflow: "hidden",
        }}
      >
        <div style={{ display: "grid", gap: device === "mobile" ? 14 : 20, padding: pad }}>
          {list.map((b, i) => (
            <section key={`${b.type}-${i}`} style={{ display: "grid", gap: 8 }}>
              <div
                style={{
                  fontFamily: `"${profile.typography.heading_font}", system-ui, sans-serif`,
                  fontSize: 11, letterSpacing: 0.4, textTransform: "uppercase", color: c.muted,
                }}
              >
                {label(String(b.type), ru)}
              </div>
              <BlockSketch type={String(b.type)} profile={profile} cols={cols} />
            </section>
          ))}
          {!list.length && (
            <div className="text-xs text-muted-foreground">{ru ? "Блоки не заданы" : "No blocks configured"}</div>
          )}
        </div>
      </div>
    </div>
  );
}
