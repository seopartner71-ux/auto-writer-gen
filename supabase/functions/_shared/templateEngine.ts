// ============================================================================
// Mustache-lite engine (single source of truth).
//
// Moved out of deploy-cloudflare-direct/dbTemplate.ts so that both the deploy
// runtime and the template importer/preview can use the very same expansion.
// Syntax: {{var}} and {{#loop}}...{{/loop}} (nesting allowed). No logic.
// Values must already be escaped by the data adapter.
// ============================================================================

export type TemplateValue = string | TemplateRow[];
export type TemplateRow = Record<string, TemplateValue>;

export function expandTemplate(tpl: string, data: TemplateRow): string {
  let out = String(tpl ?? "");

  // 1. loops (outermost first, recursive for nested blocks)
  for (;;) {
    const open = /\{\{#([\w_]+)\}\}/.exec(out);
    if (!open) break;
    const name = open[1];
    const closeTag = `{{/${name}}}`;
    const closeAt = out.indexOf(closeTag, open.index);
    if (closeAt < 0) {
      out = out.slice(0, open.index) + out.slice(open.index + open[0].length);
      continue;
    }
    const body = out.slice(open.index + open[0].length, closeAt);
    const rows = data[name];
    const rendered = Array.isArray(rows)
      ? rows.map((row) => expandTemplate(body, { ...data, ...row })).join("")
      : "";
    out = out.slice(0, open.index) + rendered + out.slice(closeAt + closeTag.length);
  }

  // 2. scalar variables
  return out.replace(/\{\{([\w_]+)\}\}/g, (_m, k: string) => {
    const v = data[k];
    return typeof v === "string" ? v : "";
  });
}
