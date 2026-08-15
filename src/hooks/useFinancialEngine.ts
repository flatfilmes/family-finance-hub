import { useQuery } from "@tanstack/react-query";
import { currentMonth } from "@/lib/expenses";
import { useExpenses } from "@/hooks/useExpenses";
import { useCreditCards, useFixedExpenses, useIncomes } from "@/hooks/useFinanceData";
import { useCardInvoices, useInstallments } from "@/hooks/useCardInvoices";
import { filterByMember } from "@/components/member-filter";
import {
  addMonthsToKey,
  currentMonthKey,
  sumInstallmentsForMonth,
  upcomingInstallmentMonths,
} from "@/lib/card-invoices";
import {
  averageVariableIncome,
  DEFAULT_SETTINGS,
  fetchFinancialSettings,
  healthStatus,
  sumFixedIncome,
  sumRecurringExpenses,
} from "@/lib/financial-engine";


export function useFinancialSettings(familyId?: string) {
  return useQuery({
    queryKey: ["financial-settings", familyId],
    queryFn: () => fetchFinancialSettings(familyId!),
    enabled: !!familyId,
  });
}

/**
 * Motor de cálculo financeiro: transforma os dados cadastrados em capacidade real de gasto.
 * `memberId` vazio = visão consolidada da família; preenchido = visão individual do membro.
 */
export function useFinancialEngine(familyId?: string, memberId = "") {
  const month = currentMonth();
  const incomes = useIncomes(familyId);
  const fixed = useFixedExpenses(familyId);
  const cards = useCreditCards(familyId);
  const expenses = useExpenses(familyId, { month, memberId: memberId || undefined });
  const settings = useFinancialSettings(familyId);
  const installments = useInstallments(familyId);
  const invoices = useCardInvoices(familyId);

  const percentualReserva =
    Number(settings.data?.percentual_reserva ?? DEFAULT_SETTINGS.percentual_reserva) || 0;
  const limiteAlertaCartao =
    Number(settings.data?.limite_alerta_cartao ?? DEFAULT_SETTINGS.limite_alerta_cartao) || 0;

  const receitasLista = filterByMember(incomes.data ?? [], memberId);
  const contasLista = filterByMember(fixed.data ?? [], memberId);
  const cartoesLista = filterByMember(cards.data ?? [], memberId);

  const receitaFixa = sumFixedIncome(receitasLista);
  const receitaVariavel = averageVariableIncome(receitasLista);
  const receitaTotal = receitaFixa + receitaVariavel;

  const mesAtual = currentMonthKey();
  const todasParcelas = installments.data ?? [];
  const faturasDoMembro = (invoices.data ?? []).filter((i) =>
    cartoesLista.some((c) => c.id === i.credit_card_id),
  );
  const parcelas = memberId
    ? todasParcelas.filter((p) => faturasDoMembro.some((i) => i.id === p.card_invoice_id))
    : todasParcelas;

  const contasFixas = sumRecurringExpenses(contasLista);
  /** Fatura atual: parcelas com vencimento no ciclo que vence neste mês. */
  const faturaCartoes = sumInstallmentsForMonth(parcelas, mesAtual);
  /** Compromisso futuro imediato: parcelas do próximo mês. */
  const parcelasFuturas = sumInstallmentsForMonth(parcelas, addMonthsToKey(mesAtual, 1));
  const proximosMeses = upcomingInstallmentMonths(parcelas, 3);
  const parcelasFuturasTotal = parcelas
    .filter((p) => p.status === "PENDENTE" && p.data_vencimento.slice(0, 7) > mesAtual)
    .reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0);

  const compromissos = contasFixas + faturaCartoes + parcelasFuturas;

  const gastosRealizados = (expenses.data ?? []).reduce(
    (acc, e) => acc + (Number(e.valor) || 0),
    0,
  );
  /** Despesas do mês que não passaram pelo cartão (o cartão entra pela fatura). */
  const gastosAvulsos = (expenses.data ?? [])
    .filter(
      (e) =>
        e.tipo_compra === "A_VISTA" &&
        e.forma_pagamento !== "CREDITO" &&
        !e.cartao_id,
    )
    .reduce((acc, e) => acc + (Number(e.valor) || 0), 0);

  const reserva = (receitaTotal * percentualReserva) / 100;
  const disponivel = receitaTotal - compromissos - gastosAvulsos - reserva;
  const saldoBruto = receitaTotal - compromissos;

  const comprometimento = receitaTotal > 0 ? (compromissos / receitaTotal) * 100 : null;

  const limiteTotalCartoes = cartoesLista
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const usoCartoes =
    limiteTotalCartoes > 0
      ? ((faturaCartoes + parcelasFuturasTotal) / limiteTotalCartoes) * 100
      : null;
  const cartaoEmAlerta = usoCartoes !== null && usoCartoes >= limiteAlertaCartao;


  const status = healthStatus({ disponivel, receita: receitaTotal, compromissos });

  const temReceitas = receitasLista.length > 0;
  const temCompromissos = contasLista.length > 0 || cartoesLista.length > 0;
  const temDespesas = (expenses.data ?? []).length > 0;
  const semDados = !temReceitas && !temCompromissos && !temDespesas;

  return {
    temReceitas,
    temCompromissos,
    temDespesas,
    semDados,
    rendaGarantida: receitaFixa,
    rendaEstimada: receitaTotal,
    isLoading:
      incomes.isLoading ||
      fixed.isLoading ||
      cards.isLoading ||
      expenses.isLoading ||
      installments.isLoading ||
      settings.isLoading,
    month,
    percentualReserva,
    limiteAlertaCartao,
    receitaFixa,
    receitaVariavel,
    receitaTotal,
    contasFixas,
    faturaCartoes,
    parcelasFuturas,
    parcelasFuturasTotal,
    proximosMeses,
    compromissos,

    gastosRealizados,
    gastosAvulsos,
    reserva,
    disponivel,
    saldoBruto,
    comprometimento,
    limiteTotalCartoes,
    usoCartoes,
    cartaoEmAlerta,
    status,
  };
}
