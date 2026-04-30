// Resolves the OpenRouter model id based on the project's ai_model preference.
// Centralized so all edge functions stay consistent.

export type ProjectAiModel = "gemini-flash" | "claude-sonnet";

export function resolveOpenRouterModel(pref: string | null | undefined): string {
  if (pref === "claude-sonnet") return "anthropic/claude-sonnet-4";
  return "google/gemini-2.5-flash";
}

export async function getProjectAiModel(admin: any, projectId: string | null | undefined): Promise<ProjectAiModel> {
  if (!projectId) return "gemini-flash";
  try {
    const { data } = await admin
      .from("projects")
      .select("ai_model")
      .eq("id", projectId)
      .maybeSingle();
    const v = data?.ai_model;
    return v === "claude-sonnet" ? "claude-sonnet" : "gemini-flash";
  } catch (_) {
    return "gemini-flash";
  }
}