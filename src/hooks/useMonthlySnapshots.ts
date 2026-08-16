import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useAuth } from "@/hooks/useAuth";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCardInvoices, useInstallments } from "@/hooks/useCardInvoices";
import { useCreditCards, useFixedExpenses, useIncomes } from "@/hooks/useFinanceData";
import { useFinancialSettings } from "@/hooks/useFinancialEngine";
import { useMembers } from "@/hooks/useFamilyData";
import { usePurchases, usePurchaseItemCategories } from "@/hooks/usePurchases";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { useTransactions } from "@/hooks/useTransactions";
import { filterByMember } from "@/components/member-filter";
import { DEFAULT_SETTINGS } from "@/lib/financial-engine";
import {
  buildSnapshotDraft,
  closeMonth,
  fetchClosingLogs,
  fetchSnapshots,
  monthFromCompetencia,
  reopenMonth,
  type Competencia,
  type SnapshotDraft,
} from "@/lib/monthly-snapshots";

export function useMonthlySnapshots(familyId?: string) {
  return useQuery({
    queryKey: ["monthly-snapshots", familyId],
    queryFn: () => fetchSnapshots(familyId!),
    enabled: !!familyId,
  });
}

export function useClosingLogs(familyId?: string) {
  return useQuery({
    queryKey: ["monthly-closing-logs", familyId],
    queryFn: () => fetchClosingLogs(familyId!),
    enabled: !!familyId,
  });
}

/** Snapshot já registrado de uma competência (família ou membro). */
export function useSnapshotFor(familyId: string | undefined, c: Competencia, memberId = "") {
  const query = useMonthlySnapshots(familyId);
  const alvo = (query.data ?? []).find(
    (s) => s.ano === c.ano && s.mes === c.mes && (s.member_id ?? "") === memberId,
  );
  return { ...query, snapshot: alvo ?? null };
}

/**
 * Prévia do fechamento: calcula o retrato familiar e o de cada membro
 * com os dados operacionais atuais, sem gravar nada.
 */
export function useMonthClosingPreview(familyId: string | undefined, c: Competencia) {
  const month = monthFromCompetencia(c);

  const members = useMembers(familyId);
  const incomes = useIncomes(familyId);
  const fixed = useFixedExpenses(familyId);
  const cards = useCreditCards(familyId);
  const invoices = useCardInvoices(familyId);
  const installments = useInstallments(familyId);
  const recurring = useRecurringExpenses(familyId);
  const purchases = usePurchases(familyId);
  const accounts = useBankAccounts(familyId);
  const transactions = useTransactions(familyId);
  const settings = useFinancialSettings(familyId);

  const comprasDoMes = (purchases.data ?? []).filter((p) => p.data_compra.slice(0, 7) === month);
  const itens = usePurchaseItemCategories(comprasDoMes.map((p) => p.id));

  const percentualReserva =
    Number(settings.data?.percentual_reserva ?? DEFAULT_SETTINGS.percentual_reserva) || 0;

  function draftFor(memberId: string | null): SnapshotDraft {
    const escopo = memberId ?? "";
    const cartoes = filterByMember(cards.data ?? [], escopo);
    const faturas = (invoices.data ?? []).filter((i) =>
      escopo ? cartoes.some((cc) => cc.id === i.credit_card_id) : true,
    );
    const idsFatura = new Set(faturas.map((i) => i.id));
    const parcelas = (installments.data ?? []).filter((p) =>
      escopo
        ? p.member_id === escopo || (p.card_invoice_id ? idsFatura.has(p.card_invoice_id) : false)
        : true,
    );
    const idsCompras = new Set(
      filterByMember(comprasDoMes, escopo).map((p) => p.id),
    );
    const semCategoria = (itens.data ?? []).filter(
      (i) => idsCompras.has(i.purchase_id) && !i.categoria_id,
    ).length;

    return buildSnapshotDraft({
      month,
      memberId,
      incomes: filterByMember(incomes.data ?? [], escopo),
      fixed: filterByMember(fixed.data ?? [], escopo),
      purchases: filterByMember(purchases.data ?? [], escopo),
      installments: parcelas,
      recurring: filterByMember(recurring.data ?? [], escopo),
      invoices: faturas,
      accounts: filterByMember(accounts.data ?? [], escopo),
      transactions: filterByMember(transactions.data ?? [], escopo),
      percentualReserva,
      semCategoria,
    });
  }

  const familiar = draftFor(null);
  const individuais = (members.data ?? []).map((m) => ({ member: m, draft: draftFor(m.id) }));

  return {
    month,
    isLoading:
      members.isLoading ||
      incomes.isLoading ||
      fixed.isLoading ||
      cards.isLoading ||
      invoices.isLoading ||
      installments.isLoading ||
      recurring.isLoading ||
      purchases.isLoading ||
      accounts.isLoading ||
      transactions.isLoading,
    familiar,
    individuais,
    drafts: [familiar, ...individuais.map((i) => i.draft)],
  };
}

export function useCloseMonth(familyId?: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (drafts: SnapshotDraft[]) =>
      closeMonth({ familyId: familyId!, userId: user?.id ?? null, drafts }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["monthly-snapshots", familyId] });
      void qc.invalidateQueries({ queryKey: ["monthly-closing-logs", familyId] });
    },
  });
}

export function useReopenMonth(familyId?: string) {
  const qc = useQueryClient();
  const { user } = useAuth();
  return useMutation({
    mutationFn: (input: { ano: number; mes: number; motivo?: string }) =>
      reopenMonth({ familyId: familyId!, userId: user?.id ?? null, ...input }),
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["monthly-snapshots", familyId] });
      void qc.invalidateQueries({ queryKey: ["monthly-closing-logs", familyId] });
    },
  });
}
