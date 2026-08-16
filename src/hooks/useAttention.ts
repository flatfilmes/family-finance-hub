import { useMemo } from "react";
import { usePurchases, usePurchaseItemCategories } from "@/hooks/usePurchases";
import { useCardInvoices } from "@/hooks/useCardInvoices";
import { useCreditCards, useFixedExpenses } from "@/hooks/useFinanceData";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { useDocuments } from "@/hooks/useDocuments";
import { filterByMember } from "@/components/member-filter";
import { buildAttentionItems } from "@/lib/attention";

/**
 * Reúne as pendências já existentes nas outras áreas, respeitando o filtro
 * por pessoa (member_id) usado no Dashboard. Nenhum cálculo novo é criado.
 */
export function useAttention(familyId?: string, memberId = "") {
  const { data: purchases } = usePurchases(familyId);
  const { data: invoices } = useCardInvoices(familyId);
  const { data: cards } = useCreditCards(familyId);
  const { data: fixed } = useFixedExpenses(familyId);
  const { data: recurring } = useRecurringExpenses(familyId);
  const { data: documents } = useDocuments(familyId);

  const comprasDoEscopo = useMemo(
    () => filterByMember(purchases ?? [], memberId),
    [purchases, memberId],
  );
  const idsRecentes = useMemo(
    () => comprasDoEscopo.slice(0, 60).map((p) => p.id),
    [comprasDoEscopo],
  );
  const { data: itemCategorias } = usePurchaseItemCategories(idsRecentes);

  return useMemo(() => {
    const cartoesDoEscopo = filterByMember(cards ?? [], memberId);
    const idsCartoes = new Set(cartoesDoEscopo.map((c) => c.id));
    const nomeCartao = (id: string) =>
      (cards ?? []).find((c) => c.id === id)?.nome_cartao ?? "cartão";

    const itens = buildAttentionItems({
      purchases: comprasDoEscopo,
      invoices: (invoices ?? []).filter((f) => idsCartoes.has(f.credit_card_id)),
      cardName: nomeCartao,
      fixedExpenses: filterByMember(fixed ?? [], memberId),
      recurring: filterByMember(recurring ?? [], memberId),
      itensSemCategoria: (itemCategorias ?? []).filter((i) => !i.categoria_id).length,
      documentosPendentes: filterByMember(documents ?? [], memberId).filter(
        (d) => d.status === "ENVIADO" || d.status === "PROCESSADO",
      ).length,
    });

    return {
      itens,
      total: itens.length,
      urgentes: itens.filter((i) => i.prioridade === "ALTA").length,
      comprasPendentes: comprasDoEscopo,
    };
  }, [comprasDoEscopo, invoices, cards, fixed, recurring, itemCategorias, documents, memberId]);
}
