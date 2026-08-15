import { useQuery } from "@tanstack/react-query";
import {
  currentMonthKey,
  fetchCardInvoices,
  fetchInstallments,
  monthKey,
  sumInstallmentsForMonth,
  upcomingInstallmentMonths,
  type CardInvoice,
} from "@/lib/card-invoices";
import type { CreditCard } from "@/lib/finance";

export function useCardInvoices(familyId?: string) {
  return useQuery({
    queryKey: ["card-invoices", familyId],
    queryFn: () => fetchCardInvoices(familyId!),
    enabled: !!familyId,
  });
}

export function useInstallments(familyId?: string) {
  return useQuery({
    queryKey: ["expense-installments", familyId],
    queryFn: () => fetchInstallments(familyId!),
    enabled: !!familyId,
  });
}

/** Fatura atual de cada cartão + compromissos futuros por mês. */
export function useCardOverview(familyId?: string, cards: CreditCard[] = []) {
  const invoices = useCardInvoices(familyId);
  const installments = useInstallments(familyId);

  const mes = currentMonthKey();
  const lista = invoices.data ?? [];

  const porCartao = cards.map((card) => {
    const doCartao = lista.filter((i) => i.credit_card_id === card.id);
    const atual =
      doCartao.find((i) => monthKey(i.data_vencimento) === mes && i.status !== "PAGA") ??
      doCartao.find((i) => i.status === "ABERTA") ??
      null;
    const futuras = (installments.data ?? []).filter(
      (p) =>
        p.status === "PENDENTE" &&
        monthKey(p.data_vencimento) > mes &&
        doCartao.some((i) => i.id === p.card_invoice_id),
    );
    return {
      card,
      faturaAtual: atual as CardInvoice | null,
      valorFaturaAtual: Number(atual?.valor_total ?? 0),
      proximoVencimento: atual?.data_vencimento ?? null,
      parcelasFuturas: futuras.reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0),
      quantidadeParcelasFuturas: futuras.length,
    };
  });

  const todas = installments.data ?? [];

  return {
    isLoading: invoices.isLoading || installments.isLoading,
    invoices: lista,
    installments: todas,
    porCartao,
    faturaAtualTotal: sumInstallmentsForMonth(todas, mes),
    proximosMeses: upcomingInstallmentMonths(todas, 3),
  };
}
