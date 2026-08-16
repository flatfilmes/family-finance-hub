import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type RecurringExpense = Database["public"]["Tables"]["recurring_expenses"]["Row"];
export type ExpenseRecurrence = Database["public"]["Enums"]["expense_recurrence"];

export const RECURRENCE_LABELS: Record<ExpenseRecurrence, string> = {
  MENSAL: "Mensal",
  BIMESTRAL: "Bimestral",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
};

export const RECURRENCE_MONTHS: Record<ExpenseRecurrence, number> = {
  MENSAL: 1,
  BIMESTRAL: 2,
  TRIMESTRAL: 3,
  SEMESTRAL: 6,
  ANUAL: 12,
};

export const RECURRENCES = Object.keys(RECURRENCE_LABELS) as ExpenseRecurrence[];

function addMonths(dateIso: string, months: number) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + months);
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d ?? 1, last));
  return base.toISOString().slice(0, 10);
}

/** Próxima data de cobrança a partir de uma data base, respeitando a periodicidade. */
export function nextChargeDate(dateIso: string, periodicidade: ExpenseRecurrence, hoje = new Date()) {
  const passo = RECURRENCE_MONTHS[periodicidade] || 1;
  let proxima = dateIso;
  const limite = hoje.toISOString().slice(0, 10);
  let guard = 0;
  while (proxima <= limite && guard < 240) {
    proxima = addMonths(proxima, passo);
    guard += 1;
  }
  return proxima;
}

/** Valor equivalente por mês de uma recorrência (para o motor financeiro). */
export function monthlyValue(r: Pick<RecurringExpense, "valor" | "periodicidade">) {
  return (Number(r.valor) || 0) / (RECURRENCE_MONTHS[r.periodicidade] || 1);
}

/**
 * Cobranças previstas de uma recorrência dentro de uma janela de meses.
 * Recorrência cancelada não projeta competências após a data de cancelamento.
 */
export function chargesInMonths(r: RecurringExpense, meses: string[]) {
  if (!r.ativo && !r.data_cancelamento) return {} as Record<string, number>;
  const passo = RECURRENCE_MONTHS[r.periodicidade] || 1;
  const resultado: Record<string, number> = {};
  const fim = r.ativo ? null : r.data_cancelamento;
  let data = r.proxima_cobranca;
  const ultimo = meses[meses.length - 1];
  let guard = 0;
  while (data.slice(0, 7) <= (ultimo ?? "") && guard < 240) {
    const mes = data.slice(0, 7);
    if (fim && data > fim) break;
    if (meses.includes(mes)) resultado[mes] = (resultado[mes] ?? 0) + (Number(r.valor) || 0);
    data = addMonths(data, passo);
    guard += 1;
  }
  return resultado;
}

export async function fetchRecurringExpenses(familyId: string) {
  const { data, error } = await supabase
    .from("recurring_expenses")
    .select("*")
    .eq("family_id", familyId)
    .order("proxima_cobranca", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

/**
 * Cancela uma recorrência: mantém todo o histórico já gerado e apenas
 * impede novas competências a partir da data de cancelamento.
 */
export async function cancelRecurringExpense(id: string, data = new Date().toISOString().slice(0, 10)) {
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ ativo: false, data_cancelamento: data })
    .eq("id", id);
  if (error) throw error;
}

/** Reativa uma recorrência cancelada. */
export async function reactivateRecurringExpense(id: string) {
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ ativo: true, data_cancelamento: null })
    .eq("id", id);
  if (error) throw error;
}

export async function toggleRecurringExpense(id: string, ativo: boolean) {
  const { error } = await supabase.from("recurring_expenses").update({ ativo }).eq("id", id);
  if (error) throw error;
}

export async function deleteRecurringExpense(id: string) {
  const { error } = await supabase.from("recurring_expenses").delete().eq("id", id);
  if (error) throw error;
}

/** Avança a recorrência para a próxima competência. */
export async function advanceRecurringExpense(r: RecurringExpense) {
  const proxima = addMonths(r.proxima_cobranca, RECURRENCE_MONTHS[r.periodicidade] || 1);
  const { error } = await supabase
    .from("recurring_expenses")
    .update({ proxima_cobranca: proxima })
    .eq("id", r.id);
  if (error) throw error;
  return proxima;
}
