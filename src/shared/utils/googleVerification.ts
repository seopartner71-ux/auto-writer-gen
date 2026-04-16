export function normalizeGoogleVerification(value: string | null | undefined): string {
  const input = value?.trim() ?? "";

  if (!input) {
    return "";
  }

  const contentMatch = input.match(/content\s*=\s*["']([^"']+)["']/i);
  if (contentMatch?.[1]) {
    return normalizeGoogleVerification(contentMatch[1]);
  }

  const htmlFileMatch = input.match(/google-site-verification\s*:\s*google([A-Za-z0-9_-]+)\.html/i);
  if (htmlFileMatch?.[1]) {
    return htmlFileMatch[1].trim();
  }

  const assignmentMatch = input.match(/google-site-verification\s*=\s*([A-Za-z0-9_-]+)/i);
  if (assignmentMatch?.[1]) {
    return assignmentMatch[1].trim();
  }

  const bareFileMatch = input.match(/^google([A-Za-z0-9_-]+)\.html$/i);
  if (bareFileMatch?.[1]) {
    return bareFileMatch[1].trim();
  }

  return input.replace(/^['"]|['"]$/g, "");
}