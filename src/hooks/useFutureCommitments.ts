import { useCardInvoices, useInstallments } from "@/hooks/useCardInvoices";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { filterByMember } from "@/components/member-filter";
import { addMonthsToKey, currentMonthKey } from "@/lib/card-invoices";
import { chargesInMonths } from "@/lib/recurring-expenses";
import { occurrencesByCompetencia } from "@/lib/card-recurrences";

export type CommitmentMonth = {
  mes: string;
  cartao: number;
  parcelas: number;
  recorrencias: number;
  total: number;
};

/**
 * Compromissos futuros separados por origem: fatura de cartão, parcelamentos e recorrências.
 * Nunca soma o valor total da compra com as parcelas — apenas as parcelas ainda pendentes.
 */
export function useFutureCommitments(familyId?: string, memberId = "") {
  const cards = useCreditCards(familyId);
  const invoices = useCardInvoices(familyId);
  const installments = useInstallments(familyId);
  const recorrentes = useRecurringExpenses(familyId);

  const mesAtual = currentMonthKey();
  const meses = [mesAtual, addMonthsToKey(mesAtual, 1), addMonthsToKey(mesAtual, 2)];

  const cartoes = filterByMember(cards.data ?? [], memberId);
  const faturasVisiveis = (invoices.data ?? []).filter((i) =>
    cartoes.some((c) => c.id === i.credit_card_id),
  );
  const parcelas = (installments.data ?? []).filter(
    (p) =>
      p.status === "PENDENTE" &&
      (!memberId || faturasVisiveis.some((i) => i.id === p.card_invoice_id)),
  );

  const ativas = filterByMember(recorrentes.data ?? [], memberId).filter((r) => r.ativo);
  // Recorrências fora do cartão: competência pelo mês da própria cobrança.
  const recorrencias = ativas.filter((r) => !r.credit_card_id);
  // Recorrências no cartão: a ocorrência é atribuída ao CICLO pela regra de
  // fechamento, exatamente como na página do cartão (fonte única).
  const recorrenciasCartao = ativas.filter(
    (r) => r.credit_card_id && cartoes.some((c) => c.id === r.credit_card_id),
  );

  const porMes: CommitmentMonth[] = meses.map((mes) => {
    const doMes = parcelas
      .filter((p) => p.data_vencimento.slice(0, 7) === mes)
      .reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0);
    const parceladas = parcelas
      .filter((p) => p.data_vencimento.slice(0, 7) === mes && (p.total_parcelas || 1) > 1)
      .reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0);
    const rec = recorrencias.reduce(
      (acc, r) => acc + (chargesInMonths(r, meses)[mes] ?? 0),
      0,
    );
    const recCartao = recorrenciasCartao.reduce((acc, r) => {
      const card = cartoes.find((c) => c.id === r.credit_card_id);
      if (!card) return acc;
      // Não duplica quando a competência já virou parcela registrada.
      const jaLancada =
        !!r.purchase_id &&
        parcelas.some(
          (p) => p.purchase_id === r.purchase_id && p.data_vencimento.slice(0, 7) === mes,
        );
      return acc + (jaLancada ? 0 : (occurrencesByCompetencia(r, card, meses)[mes] ?? 0));
    }, 0);
    return {
      mes,
      cartao: doMes + recCartao,
      parcelas: parceladas,
      recorrencias: rec + recCartao,
      total: doMes + recCartao + rec,
    };
  });

  const esteMes = porMes[0]?.total ?? 0;
  const proximoMes = porMes[1]?.total ?? 0;
  const proximos3 = porMes.reduce((acc, m) => acc + m.total, 0);

  return {
    isLoading:
      cards.isLoading || invoices.isLoading || installments.isLoading || recorrentes.isLoading,
    meses,
    porMes,
    esteMes,
    proximoMes,
    proximos3,
    faturaAtual: porMes[0]?.cartao ?? 0,
    recorrenciasMensais: recorrencias.reduce((acc, r) => acc + (Number(r.valor) || 0), 0),
    recorrencias,
  };
}
