import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCardInvoices, useInstallments } from "@/hooks/useCardInvoices";
import { useCreditCards, useFixedExpenses, useIncomes } from "@/hooks/useFinanceData";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { usePurchases } from "@/hooks/usePurchases";
import { useFinancialSettings } from "@/hooks/useFinancialEngine";
import { filterByMember } from "@/components/member-filter";
import { sumBankBalances } from "@/lib/read-models";
import { DEFAULT_SETTINGS } from "@/lib/financial-engine";
import { averageVariableIncome } from "@/lib/financial-engine";
import { currentMonth } from "@/lib/expenses";
import { useStatementImports } from "@/hooks/useCardStatements";
import {
  buildCommitments,
  endOfMonthIso,
  freeCashStatus,
  guaranteedMonthlyIncome,
  nextIncomeDate,
  todayIso,
} from "@/lib/free-cash";

/**
 * "Comprometido" e "Dinheiro livre hoje" com composição auditável.
 * Tudo respeita o escopo de pessoa (member_id): visão família soma os membros
 * permitidos, visão individual usa apenas as contas e obrigações da pessoa.
 */
export function useFreeCash(familyId?: string, memberId = "") {
  const month = currentMonth();
  const hoje = todayIso();

  const accounts = useBankAccounts(familyId);
  const incomes = useIncomes(familyId);
  const fixed = useFixedExpenses(familyId);
  const cards = useCreditCards(familyId);
  const invoices = useCardInvoices(familyId);
  const installments = useInstallments(familyId);
  const recurring = useRecurringExpenses(familyId);
  const purchases = usePurchases(familyId);
  const statementImports = useStatementImports(familyId);
  const settings = useFinancialSettings(familyId);

  const contas = filterByMember(accounts.data ?? [], memberId).filter((a) => a.ativo);
  const saldoBancario = sumBankBalances(contas);

  const receitas = filterByMember(incomes.data ?? [], memberId);
  const cartoes = filterByMember(cards.data ?? [], memberId);
  const faturas = (invoices.data ?? []).filter((i) =>
    cartoes.some((c) => c.id === i.credit_card_id),
  );
  const idsFatura = new Set(faturas.map((i) => i.id));
  const parcelas = (installments.data ?? []).filter((p) =>
    memberId
      ? p.member_id === memberId || (p.card_invoice_id ? idsFatura.has(p.card_invoice_id) : false)
      : true,
  );

  const base = {
    month,
    fixed: filterByMember(fixed.data ?? [], memberId),
    invoices: faturas,
    installments: parcelas,
    recurring: filterByMember(recurring.data ?? [], memberId),
    purchases: filterByMember(purchases.data ?? [], memberId),
    statementImports: (statementImports.data ?? []).filter((i) =>
      cartoes.some((c) => c.id === i.credit_card_id),
    ),
  };

  // Comprometido da competência: obrigações ainda pendentes até o fim do mês.
  const comprometido = buildCommitments({ ...base, from: hoje, to: endOfMonthIso(month) });

  // Dinheiro livre hoje: obrigações entre hoje e o próximo recebimento previsto.
  const proximoRecebimento = nextIncomeDate(receitas, hoje);
  const limite = proximoRecebimento ?? endOfMonthIso(month);
  const ateProximoRecebimento = buildCommitments({ ...base, from: hoje, to: limite });

  const percentualReserva =
    Number(settings.data?.percentual_reserva ?? DEFAULT_SETTINGS.percentual_reserva) || 0;
  const rendaGarantida = guaranteedMonthlyIncome(receitas);
  const rendaVariavelEsperada = averageVariableIncome(receitas);
  const reserva = (rendaGarantida * percentualReserva) / 100;

  const livreHoje = saldoBancario - ateProximoRecebimento.total - reserva;
  const status = freeCashStatus(livreHoje, saldoBancario);

  return {
    isLoading:
      accounts.isLoading ||
      incomes.isLoading ||
      fixed.isLoading ||
      cards.isLoading ||
      invoices.isLoading ||
      installments.isLoading ||
      recurring.isLoading ||
      purchases.isLoading ||
      statementImports.isLoading,
    month,
    hoje,
    saldoBancario,
    contas: contas.length,
    comprometido,
    ateProximoRecebimento,
    proximoRecebimento,
    limiteJanela: limite,
    percentualReserva,
    reserva,
    rendaGarantida,
    rendaVariavelEsperada,
    livreHoje,
    status,
  };
}
