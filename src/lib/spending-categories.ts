import { supabase } from "@/integrations/supabase/client";
import { monthRange } from "@/lib/expenses";

/**
 * Consumo por categoria da competência — fonte única: purchases + purchase_items.
 * A tabela legada `expenses` não é mais consultada para métricas de gasto.
 */
export type CategorySpending = {
  categoriaId: string;
  total: number;
};

export const SEM_CATEGORIA = "sem-categoria";

export async function fetchCategorySpending(
  familyId: string,
  month: string,
  memberId = "",
): Promise<CategorySpending[]> {
  const { start, end } = monthRange(month);

  let query = supabase
    .from("purchase_items")
    .select(
      "valor_total, categoria_id, purchases!inner(family_id, member_id, data_compra, status_pagamento)",
    )
    .eq("purchases.family_id", familyId)
    .gte("purchases.data_compra", start)
    .lte("purchases.data_compra", end)
    .neq("purchases.status_pagamento", "CANCELADO");

  if (memberId === "sem") query = query.is("purchases.member_id", null);
  else if (memberId) query = query.eq("purchases.member_id", memberId);

  const { data, error } = await query;
  if (error) throw error;

  const totais = new Map<string, number>();
  for (const item of data ?? []) {
    const key = item.categoria_id ?? SEM_CATEGORIA;
    totais.set(key, (totais.get(key) ?? 0) + (Number(item.valor_total) || 0));
  }

  return Array.from(totais, ([categoriaId, total]) => ({ categoriaId, total })).sort(
    (a, b) => b.total - a.total,
  );
}
