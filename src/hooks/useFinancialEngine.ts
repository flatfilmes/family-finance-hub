import { useQuery } from "@tanstack/react-query";
import { currentMonth } from "@/lib/expenses";
import { useExpenses } from "@/hooks/useExpenses";
import { useCreditCards, useFixedExpenses, useIncomes } from "@/hooks/useFinanceData";
import {
  averageVariableIncome,
  DEFAULT_SETTINGS,
  fetchFinancialSettings,
  healthStatus,
  sumCardInvoices,
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

/** Motor de cálculo financeiro: transforma os dados cadastrados em capacidade real de gasto. */
export function useFinancialEngine(familyId?: string) {
  const month = currentMonth();
  const incomes = useIncomes(familyId);
  const fixed = useFixedExpenses(familyId);
  const cards = useCreditCards(familyId);
  const expenses = useExpenses(familyId, { month });
  const settings = useFinancialSettings(familyId);

  const percentualReserva =
    Number(settings.data?.percentual_reserva ?? DEFAULT_SETTINGS.percentual_reserva) || 0;
  const limiteAlertaCartao =
    Number(settings.data?.limite_alerta_cartao ?? DEFAULT_SETTINGS.limite_alerta_cartao) || 0;

  const receitaFixa = sumFixedIncome(incomes.data ?? []);
  const receitaVariavel = averageVariableIncome(incomes.data ?? []);
  const receitaTotal = receitaFixa + receitaVariavel;

  const contasFixas = sumRecurringExpenses(fixed.data ?? []);
  const faturaCartoes = sumCardInvoices(expenses.data ?? []);
  const compromissos = contasFixas + faturaCartoes;

  const gastosRealizados = (expenses.data ?? []).reduce(
    (acc, e) => acc + (Number(e.valor) || 0),
    0,
  );
  const gastosAvulsos = gastosRealizados - faturaCartoes;

  const reserva = (receitaTotal * percentualReserva) / 100;
  const disponivel = receitaTotal - compromissos - gastosAvulsos - reserva;
  const saldoBruto = receitaTotal - compromissos;

  const comprometimento = receitaTotal > 0 ? (compromissos / receitaTotal) * 100 : null;

  const limiteTotalCartoes = (cards.data ?? [])
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const usoCartoes = limiteTotalCartoes > 0 ? (faturaCartoes / limiteTotalCartoes) * 100 : null;
  const cartaoEmAlerta = usoCartoes !== null && usoCartoes >= limiteAlertaCartao;

  const status = healthStatus({ disponivel, receita: receitaTotal, compromissos });

  const temReceitas = (incomes.data ?? []).length > 0;
  const temCompromissos = (fixed.data ?? []).length > 0 || (cards.data ?? []).length > 0;
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
      settings.isLoading,
    month,
    percentualReserva,
    limiteAlertaCartao,
    receitaFixa,
    receitaVariavel,
    receitaTotal,
    contasFixas,
    faturaCartoes,
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
