#!/usr/bin/env node
// Lints Cyrillic strings in JSX/TS outside of allowed areas.
// Fails (exit 1) with a list of file:line:snippet occurrences.
//
// ============================================================
// RULE — EXCLUSIONS POLICY (do NOT relax without explicit user sign-off):
//   EXCLUDE lists contain ONLY two categories:
//     A. PERMANENT — admin UI, landing, VC writer, RU-only integrations
//        (Miralinks/GoGetLinks/Turgenev), i18n dictionaries themselves,
//        RU language heuristics (contentSanity/Validator/sanitizeKeyword/…).
//     B. LANG-BRANCH — files whose Cyrillic sits ONLY inside `language === "ru"`
//        branches (or LLM prompts gated by RU). MUST carry the header marker
//        `i18n:lang-branch` — enforced below at runtime.
//   Anything else that is "translatable but not yet done" stays in the DEBT
//   (the lint output) — it MUST NOT be added here to hide the number.
//   Adding a new entry requires explicit user confirmation in chat.
// ============================================================
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const ROOT = "src";
const CYR = /[А-Яа-яЁё]/;

// A. PERMANENT exclusions — never translated.
const PERMANENT_EXCLUDE = [
  "src/components/admin/",
  "src/components/landing/",
  "src/components/vc-writer/",
  "src/pages/VcWriterPage.tsx",
  "src/pages/AdminPage.tsx",
  "src/features/geo/constants.ts",
  "src/shared/hooks/useI18n.tsx",
  "src/shared/i18n/",
  "src/shared/utils/liveTurgenev.ts",
  "src/features/article-editor/LiveTurgenevBadge.tsx",
  "src/shared/utils/contentSanity.ts",
  "src/shared/utils/contentValidator.ts",
  "src/shared/utils/sanitizeKeyword.ts",
  "src/shared/utils/sentenceStructure.ts",
  "src/components/article/humanScore/",
  "src/components/article/HumanScorePanel.tsx",
  "src/components/article/MiralinksWidget.tsx",
  "src/components/article/GoGetLinksWidget.tsx",
  "src/features/commercial/constants.ts",
];

// B. LANG-BRANCH — MUST contain the marker `i18n:lang-branch` in file header
//    (checked at runtime; missing marker fails the lint).
const LANG_BRANCH_EXCLUDE = [
  "src/components/article/SeoTipTicker.tsx",
  "src/features/article-quality/useFixIssue.ts",
];

const EXCLUDE_PREFIXES = [...PERMANENT_EXCLUDE, ...LANG_BRANCH_EXCLUDE];

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else if (/\.(tsx?|jsx?)$/.test(name)) out.push(p);
  }
  return out;
}

function isExcluded(path) {
  const rel = relative(".", path).replaceAll("\\", "/");
  return EXCLUDE_PREFIXES.some((p) => rel === p || rel.startsWith(p));
}

// Enforce the `i18n:lang-branch` marker for category B entries.
const markerErrors = [];
for (const p of LANG_BRANCH_EXCLUDE) {
  try {
    const head = readFileSync(p, "utf8").split("\n").slice(0, 5).join("\n");
    if (!head.includes("i18n:lang-branch")) {
      markerErrors.push(`${p}: missing 'i18n:lang-branch' marker in first 5 lines`);
    }
  } catch {
    markerErrors.push(`${p}: file not found (stale LANG_BRANCH_EXCLUDE entry)`);
  }
}
if (markerErrors.length) {
  console.log("[lint:i18n] LANG_BRANCH_EXCLUDE integrity failure:");
  console.log(markerErrors.map((s) => "  " + s).join("\n"));
  process.exit(1);
}

const files = walk(ROOT).filter((f) => !isExcluded(f));
const hits = [];
for (const file of files) {
  const src = readFileSync(file, "utf8");
  const lines = src.split("\n");
  let inBlockComment = false;
  for (let i = 0; i < lines.length; i++) {
    let line = lines[i];
    // strip block comments (naive per-line)
    if (inBlockComment) {
      const end = line.indexOf("*/");
      if (end === -1) continue;
      line = line.slice(end + 2);
      inBlockComment = false;
    }
    const bs = line.indexOf("/*");
    if (bs !== -1) {
      const be = line.indexOf("*/", bs + 2);
      if (be === -1) { inBlockComment = true; line = line.slice(0, bs); }
      else line = line.slice(0, bs) + line.slice(be + 2);
    }
    const ls = line.indexOf("//");
    if (ls !== -1) line = line.slice(0, ls);
    if (!CYR.test(line)) continue;
    hits.push(`${file}:${i + 1}: ${lines[i].trim().slice(0, 160)}`);
  }
}

if (hits.length) {
  console.log(hits.join("\n"));
  console.log(`\n[lint:i18n] ${hits.length} Cyrillic occurrences in ${new Set(hits.map(h => h.split(":")[0])).size} files.`);
  process.exit(1);
}
console.log("[lint:i18n] OK — no Cyrillic outside allowed areas.");
