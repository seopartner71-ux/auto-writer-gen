// ============================================================================
// TEMPLATE CONTRACT V1 - single source of truth for the template validator.
//
// Derived 1:1 from the bundled landing-home manifest (the built-in template)
// AND from the five production data adapters that feed the template runtime:
//   homeTemplateData.ts      -> HomeTemplateData
//   commerceTemplateData.ts  -> CategoryTemplateData / ProductTemplateData
//   hubTemplateData.ts       -> HubTemplateData
//   articleTemplateData.ts   -> ArticleTemplateData
// No new contract is introduced here: the lists below only describe what the
// already-shipping runtime actually emits and what the reference bundle uses.
// ============================================================================

export const REQUIRED_PAGES = ["home", "category", "product", "hub", "article"] as const;

export const ALLOWED_VARIABLES: string[] = [
  // --- theme tokens -------------------------------------------------------
  "site_name",
  "accent",
  "bg",
  "ink",
  "muted",
  "surface",
  "border",
  "card_radius",
  "btn_radius",
  "shadow",
  "section_pad",
  "heading_font",
  "body_font",
  // --- hero / landing -----------------------------------------------------
  "hero_image",
  "hero_badge",
  "hero_title",
  "hero_subtitle",
  "cta_primary",
  "cta_primary_url",
  "cta_secondary",
  "cta_secondary_url",
  "cta_note",
  "cta_title",
  "cta_text",
  "form_title",
  "form_subtitle",
  "form_name_placeholder",
  "form_phone_placeholder",
  "form_email_placeholder",
  "form_short_name_placeholder",
  "form_sent_label",
  "form_sent_short_label",
  "consent_line",
  // --- section labels -----------------------------------------------------
  "label_benefits",
  "label_services",
  "label_process",
  "label_team",
  "label_guarantee",
  "label_testimonials",
  "label_blog",
  "label_about",
  "label_contacts",
  "label_address",
  "label_phone",
  "label_hours",
  "label_more_about",
  "label_articles",
  "label_brand",
  "label_catalog",
  "label_categories",
  "label_count_unit",
  "label_delivery",
  "label_description",
  "label_details",
  "label_faq",
  "label_filters",
  "label_open",
  "label_products",
  "label_products_count",
  "label_related",
  "label_sku",
  "label_specs",
  "label_subcategories",
  "label_toc",
  // --- section titles -----------------------------------------------------
  "title_services",
  "subtitle_services",
  "title_process",
  "title_team",
  "title_testimonials",
  "title_contacts",
  "why_title",
  "why_text",
  "why_image",
  "guarantee_title",
  "guarantee_text",
  "guarantee_image",
  "blog_title",
  "blog_empty_text",
  "about_title",
  "about_text",
  "about_image",
  "cta_section_title",
  "cta_section_text",
  // --- contacts -----------------------------------------------------------
  "map_src",
  "phone",
  "phone_href",
  "email",
  "address",
  "work_hours",
  // --- commerce / silo / article page fields ------------------------------
  "h1",
  "intro",
  "html",
  "heading",
  "name",
  "title",
  "url",
  "image",
  "image_placeholder",
  "gallery_main",
  "description",
  "short_description",
  "excerpt",
  "price",
  "currency",
  "brand",
  "sku",
  "count",
  "availability",
  "availability_mod",
  "products_count",
  "catalog_url",
  "category_name",
  "category_url",
  "author",
  "author_image",
  "date",
  "date_iso",
  "reading_time",
];

/**
 * Show/hide wrappers. The adapters emit them as arrays holding 0 or 1 empty
 * rows, so mustache-lite renders the block only when the value is present.
 * They are written with the loop syntax but carry no own fields: everything
 * inside them resolves against ALLOWED_VARIABLES.
 */
export const CONDITIONAL_SECTIONS: string[] = [
  "has_articles",
  "has_author",
  "has_author_image",
  "has_body",
  "has_brand",
  "has_categories",
  "has_category",
  "has_count",
  "has_cta_secondary",
  "has_date",
  "has_delivery",
  "has_description",
  "has_excerpt",
  "has_facts",
  "has_faq",
  "has_filters",
  "has_gallery",
  "has_heading",
  "has_image",
  "has_intro",
  "has_key_specs",
  "has_phone",
  "has_price",
  "has_products",
  "has_reading_time",
  "has_related",
  "has_short_description",
  "has_sku",
  "has_specs",
  "has_subcategories",
  "has_thumbs",
  "has_toc",
  "no_gallery",
  "no_image",
];

export const ALLOWED_LOOPS: string[] = [
  "articles",
  "body_blocks",
  "breadcrumbs",
  "bullets",
  "categories",
  "delivery",
  "facts",
  "faq",
  "features",
  "filters",
  "gallery",
  "gallery_thumbs",
  "guarantee_bullets",
  "key_specs",
  "posts",
  "process",
  "products",
  "related",
  "services",
  "specs",
  "stats",
  "subcategories",
  "team",
  "testimonials",
  "toc",
];

export const LOOP_FIELDS: Record<string, string[]> = {
  "stats": [
    "value",
    "label"
  ],
  "features": [
    "icon",
    "title",
    "text"
  ],
  "services": [
    "modifier",
    "title",
    "price",
    "bullets_html",
    "cta"
  ],
  "bullets": [
    "text"
  ],
  "guarantee_bullets": [
    "text"
  ],
  "process": [
    "icon",
    "title",
    "text"
  ],
  "team": [
    "name",
    "role",
    "bio",
    "image"
  ],
  "testimonials": [
    "stars",
    "rating",
    "text",
    "name",
    "role",
    "image"
  ],
  "posts": [
    "title",
    "excerpt",
    "url",
    "image"
  ],
  "filters": [
    "label",
    "url",
    "count"
  ],
  "subcategories": [
    "name",
    "url",
    "count"
  ],
  "products": [
    "name",
    "url",
    "image",
    "price",
    "currency",
    "brand",
    "availability",
    "availability_mod",
    "sku",
    "short_description",
    "label_details"
  ],
  "related": [
    "name",
    "title",
    "url",
    "image",
    "price",
    "excerpt",
    "date",
    "availability",
    "availability_mod",
    "brand",
    "label_details"
  ],
  "body_blocks": [
    "heading",
    "text"
  ],
  "faq": [
    "q",
    "a"
  ],
  "breadcrumbs": [
    "label",
    "url"
  ],
  "gallery": [
    "src",
    "alt"
  ],
  "gallery_thumbs": [
    "src",
    "alt"
  ],
  "key_specs": [
    "key",
    "value"
  ],
  "specs": [
    "key",
    "value"
  ],
  "delivery": [
    "text"
  ],
  "categories": [
    "name",
    "url",
    "description",
    "image",
    "count",
    "label_open"
  ],
  "articles": [
    "title",
    "url",
    "excerpt",
    "image",
    "date"
  ],
  "facts": [
    "label",
    "value"
  ],
  "toc": [
    "id",
    "title"
  ]
};

/**
 * Inline event handlers are forbidden with one narrow, explicitly listed
 * exception: the progressive-enhancement `onsubmit` of the built-in lead
 * forms. It is still checked against FORBIDDEN_HANDLER_TOKENS below, so no
 * network call, navigation, storage or eval can hide in it.
 * onclick / onload / onerror / onmouseover ... stay rejected.
 */
export const ALLOWED_INLINE_HANDLERS: string[] = ["onsubmit"];

export const FORBIDDEN_HANDLER_TOKENS: RegExp[] =
  [/\bfetch\b/i, /XMLHttpRequest/i, /\bimport\b/i, /\beval\b/i, /\bFunction\b/, /location/i,
   /document\s*\.\s*cookie/i, /localStorage/i, /sessionStorage/i, /\bwindow\b/i,
   /javascript\s*:/i, /\bsrc\b\s*=/i, /<\s*script/i];

/** `onsubmit` must neutralise the native submit - nothing else is accepted. */
export const REQUIRED_HANDLER_PREFIX = /^\s*event\.preventDefault\(\s*\)\s*;/;

/**
 * Iframes are allowed for the contact map slot only: either the templated
 * {{map_src}} placeholder or a https map provider from this list.
 */
export const ALLOWED_IFRAME_SRC: RegExp[] = [
  /^\{\{map_src\}\}$/,
  /^https:\/\/(yandex\.[a-z.]+|api-maps\.yandex\.ru|maps\.google\.[a-z.]+|www\.google\.[a-z.]+\/maps|www\.openstreetmap\.org|2gis\.[a-z.]+)\//i,
];

/** Assets allowed inside template.zip (lowercase, with dot). */
export const ALLOWED_ASSET_EXT = [
  ".css", ".svg", ".png", ".jpg", ".jpeg", ".webp", ".avif", ".gif", ".ico",
  ".woff", ".woff2", ".ttf", ".otf",
];

export const LIMITS = {
  zipBytes: 8 * 1024 * 1024,
  fileBytes: 1024 * 1024,
  totalBytes: 20 * 1024 * 1024,
  fileCount: 200,
};
