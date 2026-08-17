import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchEvidenceImports } from "@/lib/financial-evidence/data";

export function useEvidenceImports(familyId?: string) {
  return useQuery({
    queryKey: ["evidence-imports", familyId],
    queryFn: () => fetchEvidenceImports(familyId!),
    enabled: !!familyId,
  });
}

/** Itens de evidências anteriores da família — base da idempotência por linhagem. */
export function useEvidenceItemsByFamily(familyId?: string) {
  return useQuery({
    queryKey: ["evidence-items-family", familyId],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("financial_evidence_items")
        .select(
          "id, evidence_import_id, source_item_key, event_date, posting_date, amount, direction, description, card_last4, matched_purchase_id, matched_transaction_id",
        )
        .eq("family_id", familyId!);
      if (error) throw error;
      return data;
    },
    enabled: !!familyId,
  });
}
