// ============================================================================
// TEMPLATE CONTRACT V1 - single source of truth for the template validator.
//
// Derived 1:1 from the bundled landing-home manifest (the built-in template),
// which mirrors the existing TemplateData contracts:
//   HomeTemplateData / CategoryTemplateData / ProductTemplateData /
//   HubTemplateData / ArticleTemplateData
// No new contract is introduced here.
// ============================================================================

export const REQUIRED_PAGES = ["home", "category", "product", "hub", "article"] as const;

export const ALLOWED_VARIABLES: string[] = [
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
  "hero_image",
  "hero_badge",
  "hero_title",
  "hero_subtitle",
  "cta_primary",
  "cta_secondary",
  "form_title",
  "form_subtitle",
  "form_name_placeholder",
  "form_phone_placeholder",
  "form_email_placeholder",
  "form_short_name_placeholder",
  "form_sent_label",
  "form_sent_short_label",
  "consent_line",
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
  "map_src",
  "phone",
  "phone_href",
  "email",
  "address",
  "work_hours"
];

export const ALLOWED_LOOPS: string[] = [
  "articles",
  "body_blocks",
  "breadcrumbs",
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
  "toc"
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
    "short_description"
  ],
  "related": [
    "name",
    "url",
    "image",
    "price",
    "availability",
    "availability_mod",
    "brand"
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
    "count"
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
