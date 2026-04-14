import { useState, useEffect, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/shared/hooks/useAuth";

const LS_KEY = "onboarding_state";

interface OnboardingState {
  dismissed: boolean;
  researchDone: boolean;
  structureDone: boolean;
  articleDone: boolean;
  congratsShown: boolean;
  registeredAt: string | null;
  reminderShown: boolean;
}

const defaultState: OnboardingState = {
  dismissed: false,
  researchDone: false,
  structureDone: false,
  articleDone: false,
  congratsShown: false,
  registeredAt: null,
  reminderShown: false,
};

function loadState(): OnboardingState {
  try {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) return { ...defaultState, ...JSON.parse(raw) };
  } catch {}
  return { ...defaultState };
}

function saveState(state: OnboardingState) {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
}

export function useOnboarding() {
  const { user, profile } = useAuth();
  const [state, setState] = useState<OnboardingState>(loadState);
  const [articleCount, setArticleCount] = useState<number | null>(null);
  const [keywordCount, setKeywordCount] = useState<number | null>(null);

  // Fetch counts to determine progress
  useEffect(() => {
    if (!user) return;
    const fetchCounts = async () => {
      const [artRes, kwRes] = await Promise.all([
        supabase.from("articles").select("id", { count: "exact", head: true }),
        supabase.from("keywords").select("id", { count: "exact", head: true }).not("intent", "is", null),
      ]);
      setArticleCount(artRes.count ?? 0);
      setKeywordCount(kwRes.count ?? 0);
    };
    fetchCounts();
  }, [user]);

  // Set registeredAt from profile
  useEffect(() => {
    if (profile?.created_at && !state.registeredAt) {
      updateState({ registeredAt: profile.created_at });
    }
  }, [profile]);

  // Auto-detect completed steps
  useEffect(() => {
    if (keywordCount === null || articleCount === null) return;
    const updates: Partial<OnboardingState> = {};
    if (keywordCount > 0 && !state.researchDone) updates.researchDone = true;
    if (articleCount > 0 && !state.articleDone) updates.articleDone = true;
    // Structure is considered done if there's at least one keyword with recommended_headings
    if (Object.keys(updates).length > 0) updateState(updates);
  }, [keywordCount, articleCount]);

  const updateState = useCallback((partial: Partial<OnboardingState>) => {
    setState(prev => {
      const next = { ...prev, ...partial };
      saveState(next);
      return next;
    });
  }, []);

  const completedSteps = [state.researchDone, state.structureDone, state.articleDone].filter(Boolean).length;
  const isNewUser = articleCount !== null && articleCount === 0 && !state.dismissed;
  const showModal = isNewUser && !state.dismissed && articleCount === 0;

  // Check for 24h reminder
  const shouldShowReminder = (() => {
    if (state.reminderShown || state.dismissed || completedSteps > 0) return false;
    if (!state.registeredAt) return false;
    const diff = Date.now() - new Date(state.registeredAt).getTime();
    return diff > 24 * 60 * 60 * 1000;
  })();

  const showCongrats = completedSteps === 3 && !state.congratsShown;

  const dismiss = useCallback(() => updateState({ dismissed: true }), [updateState]);
  const markResearchDone = useCallback(() => updateState({ researchDone: true }), [updateState]);
  const markStructureDone = useCallback(() => updateState({ structureDone: true }), [updateState]);
  const markArticleDone = useCallback(() => updateState({ articleDone: true }), [updateState]);
  const markCongratsShown = useCallback(() => updateState({ congratsShown: true }), [updateState]);
  const markReminderShown = useCallback(() => updateState({ reminderShown: true }), [updateState]);

  return {
    state,
    completedSteps,
    isNewUser,
    showModal,
    showCongrats,
    shouldShowReminder,
    dismiss,
    markResearchDone,
    markStructureDone,
    markArticleDone,
    markCongratsShown,
    markReminderShown,
  };
}
