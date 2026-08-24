// ============================================================================
// TEMPLATE IMPORT V1 - strict validator + sanitizer.
//
// Runs BEFORE anything is stored. On any error the import is rejected
// completely: no partial install, no silent fallback.
// ============================================================================

import {
  ALLOWED_ASSET_EXT,
  ALLOWED_IFRAME_SRC,
  ALLOWED_INLINE_HANDLERS,
  ALLOWED_LOOPS,
  ALLOWED_VARIABLES,
  CONDITIONAL_SECTIONS,
  FORBIDDEN_HANDLER_TOKENS,
  LIMITS,
  LOOP_FIELDS,
  REQUIRED_HANDLER_PREFIX,
  REQUIRED_PAGES,
} from "./templateContract.ts";


export interface TemplateManifest {
  name: string;
  version: string;
  engine: string;
  description?: string;
  pages: Record<string, string>;
  assets?: { css?: string };
}

export interface ZipEntry {
  path: string;
  bytes: Uint8Array;
}

export interface ValidationResult {
  ok: boolean;
  errors: string[];
  warnings: string[];
  manifest?: TemplateManifest;
  /** Sanitized page html keyed by page type (home/category/...). */
  pages?: Record<string, string>;
  /** theme css text. */
  css?: string;
  /** Non-css asset files (already size/extension checked). */
  assets?: ZipEntry[];
}

const FORBIDDEN_HTML: { re: RegExp; msg: string }[] = [
  { re: /<script\b/i, msg: "запрещён тег <script>" },
  { re: /<object\b/i, msg: "запрещён тег <object>" },
  { re: /<embed\b/i, msg: "запрещён тег <embed>" },
  { re: /<base\b/i, msg: "запрещён тег <base>" },
  { re: /<link\b[^>]*rel\s*=\s*["']?import/i, msg: "запрещён HTML import" },
  { re: /javascript\s*:/i, msg: "запрещён javascript: URL" },
  { re: /data:text\/html/i, msg: "запрещён data:text/html" },
  { re: /<\?php|<\?=|<%[=@]?|\{%|\{\{\s*\w+\s*\|/i, msg: "запрещён server-side/template код (php, jinja, erb, twig)" },
  { re: /\$\{[^}]*\}/, msg: "запрещены выражения ${...}" },
];

const FORBIDDEN_CSS: { re: RegExp; msg: string }[] = [
  { re: /javascript\s*:/i, msg: "javascript: в CSS" },
  { re: /expression\s*\(/i, msg: "CSS expression()" },
  { re: /@import\s+url\(\s*["']?https?:/i, msg: "внешний @import в CSS" },
  // Only the legacy IE `behavior:` property, never `scroll-behavior` etc.
  { re: /(^|[\s;{])behavior\s*:/i, msg: "CSS behavior:" },
];

function ext(p: string): string {
  const i = p.lastIndexOf(".");
  return i < 0 ? "" : p.slice(i).toLowerCase();
}

/** Rejects traversal / absolute / hidden paths. */
function unsafePath(p: string): boolean {
  return p.includes("..") || p.startsWith("/") || p.startsWith("\\") || /(^|\/)\./.test(p);
}

/** True when this inline handler is the narrow, contract-listed exception. */
function handlerAllowed(attr: string, value: string): boolean {
  if (!ALLOWED_INLINE_HANDLERS.includes(attr.toLowerCase())) return false;
  if (!REQUIRED_HANDLER_PREFIX.test(value)) return false;
  return !FORBIDDEN_HANDLER_TOKENS.some((re) => re.test(value));
}

function checkInlineHandlers(html: string, page: string, errors: string[]): void {
  for (const m of html.matchAll(/\s(on[a-z]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi)) {
    const attr = m[1].toLowerCase();
    const value = m[3] ?? m[4] ?? m[5] ?? "";
    if (handlerAllowed(attr, value)) continue;
    errors.push(`${page}: запрещён inline-обработчик события ${attr}=`);
  }
}

function checkIframes(html: string, page: string, errors: string[]): void {
  for (const m of html.matchAll(/<iframe\b[^>]*>/gi)) {
    const src = /src\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] || "";
    if (!ALLOWED_IFRAME_SRC.some((re) => re.test(src))) {
      errors.push(`${page}: <iframe> разрешён только для карты контактов (src=${src || "пусто"})`);
    }
  }
}

function checkPlaceholders(html: string, page: string, errors: string[]): void {
  // loops + conditional show/hide sections
  const loopNames = new Set<string>();
  for (const m of html.matchAll(/\{\{[#/]([\w_]+)\}\}/g)) loopNames.add(m[1]);
  for (const name of loopNames) {
    if (!ALLOWED_LOOPS.includes(name) && !CONDITIONAL_SECTIONS.includes(name)) {
      errors.push(`${page}: неизвестный цикл {{#${name}}}`);
    }
  }
  // opened == closed
  for (const name of loopNames) {
    const opens = (html.match(new RegExp(`\\{\\{#${name}\\}\\}`, "g")) || []).length;
    const closes = (html.match(new RegExp(`\\{\\{/${name}\\}\\}`, "g")) || []).length;
    if (opens !== closes) errors.push(`${page}: цикл {{#${name}}} не закрыт корректно`);
  }
  // scalars: allowed globally, or as a field of an enclosing loop
  for (const m of html.matchAll(/\{\{([\w_]+)\}\}/g)) {
    const v = m[1];
    if (ALLOWED_VARIABLES.includes(v)) continue;
    const inLoopFields = [...loopNames].some((l) => (LOOP_FIELDS[l] || []).includes(v));
    if (inLoopFields) continue;
    errors.push(`${page}: неизвестная переменная {{${v}}}`);
  }
  // stray/broken placeholder syntax
  const opens = (html.match(/\{\{/g) || []).length;
  const closes = (html.match(/\}\}/g) || []).length;
  if (opens !== closes) errors.push(`${page}: несбалансированные {{ }}`);
}

function checkHtmlWellFormed(html: string, page: string, errors: string[]): void {
  const tags = ["div", "section", "article", "ul", "ol", "li", "a", "p", "span", "main", "figure"];
  for (const t of tags) {
    const o = (html.match(new RegExp(`<${t}(\\s|>)`, "gi")) || []).length;
    const c = (html.match(new RegExp(`</${t}>`, "gi")) || []).length;
    if (o !== c) errors.push(`${page}: несбалансированный тег <${t}> (открыт ${o}, закрыт ${c})`);
  }
  if (/<\/?(html|head|body)\b/i.test(html)) {
    errors.push(`${page}: шаблон страницы должен содержать только содержимое <main>, без <html>/<head>/<body>`);
  }
}

function checkForms(html: string, page: string, errors: string[]): void {
  for (const m of html.matchAll(/<form\b[^>]*>/gi)) {
    const action = /action\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] || "";
    if (/^https?:\/\//i.test(action)) {
      errors.push(`${page}: form action на внешний URL запрещён (${action})`);
    }
  }
}

function checkExternalScripts(html: string, page: string, errors: string[]): void {
  for (const m of html.matchAll(/<link\b[^>]*>/gi)) {
    const href = /href\s*=\s*["']([^"']*)["']/i.exec(m[0])?.[1] || "";
    if (/^https?:\/\//i.test(href) && !/fonts\.(googleapis|gstatic)\.com/i.test(href)) {
      errors.push(`${page}: внешний ресурс в <link> запрещён (${href})`);
    }
  }
}

/** Removes anything that slipped through as an extra safety net. */
export function sanitizeHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, "")
    .replace(/<iframe\b[^>]*>[\s\S]*?<\/iframe>/gi, (tag) => {
      const src = /src\s*=\s*["']([^"']*)["']/i.exec(tag)?.[1] || "";
      return ALLOWED_IFRAME_SRC.some((re) => re.test(src)) ? tag : "";
    })
    .replace(/<(object|embed|base)\b[^>]*>[\s\S]*?<\/\1>/gi, "")
    .replace(/<(object|embed|base)\b[^>]*\/?>/gi, "")
    .replace(
      /\s(on[a-z]+)\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))/gi,
      (full, attr: string, _q, dq?: string, sq?: string, bare?: string) =>
        handlerAllowed(attr, dq ?? sq ?? bare ?? "") ? full : "",
    )
    .replace(/javascript\s*:/gi, "#");
}

export function sanitizeCss(css: string): string {
  return css
    .replace(/javascript\s*:/gi, "#")
    .replace(/expression\s*\([^)]*\)/gi, "none")
    .replace(/(^|[\s;{])behavior\s*:[^;]+;?/gi, "$1");
}


export function validateTemplateBundle(entries: ZipEntry[], zipBytes: number): ValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  if (zipBytes > LIMITS.zipBytes) {
    errors.push(`ZIP больше лимита (${(zipBytes / 1048576).toFixed(1)} MB > ${LIMITS.zipBytes / 1048576} MB)`);
  }
  if (entries.length > LIMITS.fileCount) {
    errors.push(`Слишком много файлов в архиве (${entries.length} > ${LIMITS.fileCount})`);
  }
  const total = entries.reduce((s, e) => s + e.bytes.length, 0);
  if (total > LIMITS.totalBytes) {
    errors.push(`Суммарный размер файлов превышает ${LIMITS.totalBytes / 1048576} MB`);
  }
  for (const e of entries) {
    if (unsafePath(e.path)) errors.push(`Недопустимый путь в архиве: ${e.path}`);
    if (e.bytes.length > LIMITS.fileBytes) {
      errors.push(`Файл ${e.path} больше ${LIMITS.fileBytes / 1024} KB`);
    }
  }
  if (errors.length) return { ok: false, errors, warnings };

  const byPath = new Map(entries.map((e) => [e.path, e]));
  const dec = new TextDecoder();

  // --- manifest ---------------------------------------------------------
  const manifestEntry = byPath.get("template.json");
  if (!manifestEntry) {
    return { ok: false, errors: ["template.json отсутствует в корне архива"], warnings };
  }
  let manifest: TemplateManifest;
  try {
    manifest = JSON.parse(dec.decode(manifestEntry.bytes));
  } catch (e) {
    return { ok: false, errors: [`template.json не является валидным JSON: ${(e as Error).message}`], warnings };
  }
  if (!manifest?.name || typeof manifest.name !== "string") errors.push("template.json: отсутствует name");
  if (!manifest?.version || !/^\d+\.\d+(\.\d+)?$/.test(String(manifest.version))) {
    errors.push("template.json: version должна быть в формате 1.0.0");
  }
  if (!manifest?.engine || typeof manifest.engine !== "string") errors.push("template.json: отсутствует engine");
  if (manifest?.engine && !/mustache-lite/i.test(manifest.engine)) {
    errors.push(`template.json: неподдерживаемый engine "${manifest.engine}" (ожидается mustache-lite@dbTemplate)`);
  }
  if (!manifest?.pages || typeof manifest.pages !== "object") errors.push("template.json: отсутствует объект pages");

  if (errors.length) return { ok: false, errors, warnings };

  // --- pages ------------------------------------------------------------
  const pages: Record<string, string> = {};
  for (const type of REQUIRED_PAGES) {
    const rel = manifest.pages[type] || `pages/${type}.html`;
    const entry = byPath.get(rel);
    if (!entry) {
      errors.push(`Отсутствует обязательный шаблон страницы: ${rel}`);
      continue;
    }
    const raw = dec.decode(entry.bytes);
    for (const rule of FORBIDDEN_HTML) {
      if (rule.re.test(raw)) errors.push(`${rel}: ${rule.msg}`);
    }
    checkInlineHandlers(raw, rel, errors);
    checkIframes(raw, rel, errors);
    checkPlaceholders(raw, rel, errors);
    checkHtmlWellFormed(raw, rel, errors);
    checkForms(raw, rel, errors);
    checkExternalScripts(raw, rel, errors);

    pages[type] = sanitizeHtml(raw);
  }

  // --- css --------------------------------------------------------------
  const cssPath = manifest.assets?.css || "assets/theme.css";
  const cssEntry = byPath.get(cssPath);
  if (!cssEntry) {
    errors.push(`Отсутствует ${cssPath} (единый theme.css обязателен)`);
  }
  let css = "";
  if (cssEntry) {
    css = dec.decode(cssEntry.bytes);
    for (const rule of FORBIDDEN_CSS) {
      if (rule.re.test(css)) errors.push(`${cssPath}: ${rule.msg}`);
    }
    css = sanitizeCss(css);
  }

  // --- assets -----------------------------------------------------------
  const assets: ZipEntry[] = [];
  for (const e of entries) {
    if (e.path === "template.json") continue;
    if (e.path === cssPath) continue;
    if (Object.values(manifest.pages).includes(e.path)) continue;
    if (e.path.endsWith("/")) continue;
    const x = ext(e.path);
    if (!ALLOWED_ASSET_EXT.includes(x)) {
      errors.push(`Недопустимое расширение файла: ${e.path}`);
      continue;
    }
    if (x === ".svg") {
      const svg = dec.decode(e.bytes);
      if (/<script|\son[a-z]+\s*=|javascript\s*:/i.test(svg)) {
        errors.push(`${e.path}: SVG содержит скрипт или обработчик событий`);
        continue;
      }
    }
    assets.push(e);
  }

  if (errors.length) return { ok: false, errors, warnings };
  return { ok: true, errors, warnings, manifest, pages, css, assets };
}
