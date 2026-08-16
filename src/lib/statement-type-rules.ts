/**
 * Regras de tipo de lançamento.
 *
 * "Reconhecer lançamentos semelhantes no futuro": ao corrigir o tipo de um
 * lançamento, a pessoa pode guardar a decisão. Nas próximas importações o
 * mesmo estabelecimento já chega com o tipo certo — sem criar nada sozinho.
 */
import { supabase } from "@/integrations/supabase/client";
import { normalizeDescricao } from "@/lib/card-statement-parsers";
import type { ReviewType } from "@/lib/statement-types";

export type StatementTypeRule = {
  id: string;
  family_id: string;
  match_value: string;
  tipo: string;
  credit_card_id: string | null;
  active: boolean;
  created_at: string;
};

/** Chave de comparação: descrição normalizada e sem números de parcela. */
export function chaveDaRegra(descricao: string) {
  return normalizeDescricao(descricao)
    .replace(/\b\d{1,2}\s*\/\s*\d{1,2}\b/g, " ")
    .replace(/\d+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export async function fetchStatementTypeRules(familyId: string) {
  const { data, error } = await supabase
    .from("statement_type_rules")
    .select("*")
    .eq("family_id", familyId)
    .eq("active", true);
  if (error) throw error;
  return (data ?? []) as unknown as StatementTypeRule[];
}

export async function saveStatementTypeRule(input: {
  familyId: string;
  createdBy: string | null;
  descricao: string;
  tipo: ReviewType;
  cardId: string | null;
}) {
  const matchValue = chaveDaRegra(input.descricao);
  if (!matchValue) return null;
  const { data, error } = await supabase
    .from("statement_type_rules")
    .upsert(
      {
        family_id: input.familyId,
        created_by: input.createdBy,
        match_value: matchValue,
        tipo: input.tipo,
        credit_card_id: input.cardId,
        active: true,
      },
      { onConflict: "family_id,match_value" },
    )
    .select()
    .single();
  if (error) throw error;
  return data as unknown as StatementTypeRule;
}

export async function deleteStatementTypeRule(id: string) {
  const { error } = await supabase.from("statement_type_rules").delete().eq("id", id);
  if (error) throw error;
}

/** Tipo sugerido por regra para uma descrição, se houver. */
export function tipoPorRegra(
  descricao: string,
  cardId: string | null,
  regras: StatementTypeRule[],
): ReviewType | null {
  const chave = chaveDaRegra(descricao);
  if (!chave) return null;
  const candidatas = regras.filter(
    (r) => r.match_value === chave && (!r.credit_card_id || r.credit_card_id === cardId),
  );
  // Regra específica do cartão tem prioridade sobre a regra geral da família.
  const escolhida = candidatas.find((r) => r.credit_card_id) ?? candidatas[0];
  return (escolhida?.tipo as ReviewType | undefined) ?? null;
}
