// Accent colors and font pair presets per template
export const ACCENT_COLORS = [
  "#e11d48", "#0ea5e9", "#10b981", "#f59e0b",
  "#8b5cf6", "#ef4444", "#14b8a6", "#f97316",
  "#3b82f6", "#22c55e", "#d946ef", "#06b6d4",
];

export type TemplateType = "minimal" | "magazine" | "news" | "landing";

export const FONT_PAIRS: Record<TemplateType, [string, string][]> = {
  minimal: [
    ["Lora", "Inter"],
    ["Merriweather", "Lato"],
    ["Playfair Display", "Source Sans 3"],
    ["EB Garamond", "Nunito"],
  ],
  magazine: [
    ["Inter", "Inter"],
    ["DM Sans", "DM Sans"],
    ["Manrope", "Manrope"],
    ["Plus Jakarta Sans", "Plus Jakarta Sans"],
  ],
  news: [
    ["Roboto", "Roboto"],
    ["IBM Plex Sans", "IBM Plex Sans"],
    ["Open Sans", "Open Sans"],
    ["Noto Sans", "Noto Sans"],
  ],
  landing: [
    ["Outfit", "Inter"],
    ["Sora", "Manrope"],
    ["Space Grotesk", "DM Sans"],
    ["Urbanist", "Inter"],
  ],
};

export function pickRandom<T>(arr: T[]): T {
  return arr[Math.floor(Math.random() * arr.length)];
}

export function googleFontsHref(headingFont: string, bodyFont: string): string {
  const params = new URLSearchParams();
  const add = (f: string) => params.append("family", `${f.replace(/\s+/g, "+")}:wght@400;600;700`);
  add(headingFont);
  if (bodyFont !== headingFont) add(bodyFont);
  params.set("display", "swap");
  return `https://fonts.googleapis.com/css2?${params.toString()}`;
}