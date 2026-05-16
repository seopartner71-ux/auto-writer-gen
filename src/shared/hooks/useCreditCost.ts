import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

export interface CostOptions {
  modelKey: string;
  length?: number;
  stealth?: boolean;
  images?: number;
  deepResearch?: boolean;
  factCheck?: boolean;
  enabled?: boolean;
}

export interface CostBreakdown {
  credits: number;
  base: number;
  length_multiplier: number;
  min_plan: string;
  breakdown: {
    model: number;
    length_x: number;
    stealth: boolean;
    images: number;
    research: boolean;
    fact_check: boolean;
  };
}

/**
 * Calculates credit cost for a generation request via DB RPC.
 * Returns null while loading.
 */
export function useCreditCost(opts: CostOptions): CostBreakdown | null {
  const [cost, setCost] = useState<CostBreakdown | null>(null);

  useEffect(() => {
    if (opts.enabled === false || !opts.modelKey) {
      setCost(null);
      return;
    }
    let cancelled = false;

    supabase
      .rpc("calculate_generation_cost", {
        p_model_key: opts.modelKey,
        p_length: opts.length ?? 3000,
        p_stealth: !!opts.stealth,
        p_images: opts.images ?? 0,
        p_deep_research: !!opts.deepResearch,
        p_fact_check: !!opts.factCheck,
      })
      .then(({ data, error }) => {
        if (cancelled) return;
        if (error || !data) {
          setCost(null);
        } else {
          setCost(data as unknown as CostBreakdown);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [
    opts.modelKey,
    opts.length,
    opts.stealth,
    opts.images,
    opts.deepResearch,
    opts.factCheck,
    opts.enabled,
  ]);

  return cost;
}