import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { CreditCard } from "@/lib/finance";

export type CardInvoice = Database["public"]["Tables"]["card_invoices"]["Row"];
export type ExpenseInstallment = Database["public"]["Tables"]["expense_installments"]["Row"];
export type InvoiceStatus = Database["public"]["Enums"]["invoice_status"];
export type InstallmentStatus = Database["public"]["Enums"]["installment_status"];

export const INVOICE_STATUS_LABELS: Record<InvoiceStatus, string> = {
  ABERTA: "Aberta",
  FECHADA: "Fechada",
  PAGA: "Paga",
};

export const INSTALLMENT_STATUS_LABELS: Record<InstallmentStatus, string> = {
  PENDENTE: "Pendente",
  PAGO: "Pago",
};

export function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function clampDay(year: number, month: number, day: number) {
  const last = new Date(year, month + 1, 0).getDate();
  return new Date(year, month, Math.min(day, last));
}

export function parseDate(value: string) {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, d ?? 1);
}

export type Cycle = {
  data_inicio_ciclo: string;
  data_fechamento: string;
  data_vencimento: string;
};

/**
 * Ciclo de fatura ao qual uma compra pertence.
 * Compra até o dia de fechamento entra na fatura atual; depois disso, na próxima.
 */
export function cycleForDate(
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">,
  purchaseDate: string | Date,
): Cycle {
  const d = typeof purchaseDate === "string" ? parseDate(purchaseDate) : purchaseDate;
  const fechamentoDia = Math.min(31, Math.max(1, card.dia_fechamento || 1));
  const vencimentoDia = Math.min(31, Math.max(1, card.dia_vencimento || 10));

  let fechamento = clampDay(d.getFullYear(), d.getMonth(), fechamentoDia);
  if (d.getTime() > fechamento.getTime()) {
    fechamento = clampDay(d.getFullYear(), d.getMonth() + 1, fechamentoDia);
  }

  const fechamentoAnterior = clampDay(
    fechamento.getFullYear(),
    fechamento.getMonth() - 1,
    fechamentoDia,
  );
  const inicio = new Date(fechamentoAnterior);
  inicio.setDate(inicio.getDate() + 1);

  const vencimento =
    vencimentoDia > fechamentoDia
      ? clampDay(fechamento.getFullYear(), fechamento.getMonth(), vencimentoDia)
      : clampDay(fechamento.getFullYear(), fechamento.getMonth() + 1, vencimentoDia);

  return {
    data_inicio_ciclo: iso(inicio),
    data_fechamento: iso(fechamento),
    data_vencimento: iso(vencimento),
  };
}

/** Desloca um ciclo em N meses (usado para parcelas futuras). */
export function shiftCycle(
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">,
  base: Cycle,
  months: number,
): Cycle {
  const fechamento = parseDate(base.data_fechamento);
  const target = clampDay(
    fechamento.getFullYear(),
    fechamento.getMonth() + months,
    card.dia_fechamento || 1,
  );
  return cycleForDate(card, target);
}

/** Busca (ou cria) a fatura do cartão para um ciclo. */
export async function ensureInvoice(familyId: string, cardId: string, cycle: Cycle) {
  const { data: existing, error: findError } = await supabase
    .from("card_invoices")
    .select("*")
    .eq("credit_card_id", cardId)
    .eq("data_fechamento", cycle.data_fechamento)
    .maybeSingle();
  if (findError) throw findError;
  if (existing) return existing;

  const { data, error } = await supabase
    .from("card_invoices")
    .insert({ family_id: familyId, credit_card_id: cardId, ...cycle })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function fetchCardInvoices(familyId: string) {
  const { data, error } = await supabase
    .from("card_invoices")
    .select("*")
    .eq("family_id", familyId)
    .order("data_vencimento", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function fetchInstallments(familyId: string) {
  const { data, error } = await supabase
    .from("expense_installments")
    .select("*")
    .eq("family_id", familyId)
    .order("data_vencimento", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function setInvoiceStatus(id: string, status: InvoiceStatus) {
  const { error } = await supabase.from("card_invoices").update({ status }).eq("id", id);
  if (error) throw error;
}

export async function setInstallmentStatus(id: string, status: InstallmentStatus) {
  const { error } = await supabase.from("expense_installments").update({ status }).eq("id", id);
  if (error) throw error;
}

/** Recalcula o valor total de uma fatura a partir das parcelas ligadas a ela. */
export async function refreshInvoiceTotal(invoiceId: string) {
  const { data, error } = await supabase
    .from("expense_installments")
    .select("valor_parcela")
    .eq("card_invoice_id", invoiceId);
  if (error) throw error;
  const total = (data ?? []).reduce((acc, r) => acc + (Number(r.valor_parcela) || 0), 0);
  const { error: upError } = await supabase
    .from("card_invoices")
    .update({ valor_total: total })
    .eq("id", invoiceId);
  if (upError) throw upError;
}

/**
 * Gera as parcelas de uma despesa no cartão, cada uma ligada à fatura do seu ciclo.
 * Compras à vista no cartão geram uma única parcela.
 */
export async function generateInstallments(input: {
  familyId: string;
  expenseId: string;
  card: CreditCard;
  dataCompra: string;
  valorTotal: number;
  parcelas: number;
  memberId?: string | null;
  purchaseId?: string | null;
}) {
  const total = Math.max(1, input.parcelas || 1);
  const valorParcela = Math.round((input.valorTotal / total) * 100) / 100;
  const base = cycleForDate(input.card, input.dataCompra);

  const rows: Database["public"]["Tables"]["expense_installments"]["Insert"][] = [];
  const invoiceIds: string[] = [];

  for (let i = 0; i < total; i++) {
    const cycle = i === 0 ? base : shiftCycle(input.card, base, i);
    const invoice = await ensureInvoice(input.familyId, input.card.id, cycle);
    invoiceIds.push(invoice.id);
    rows.push({
      family_id: input.familyId,
      expense_id: input.expenseId,
      card_invoice_id: invoice.id,
      numero_parcela: i + 1,
      total_parcelas: total,
      valor_parcela: valorParcela,
      data_vencimento: cycle.data_vencimento,
    });
  }

  const { error } = await supabase.from("expense_installments").insert(rows);
  if (error) throw error;

  for (const id of [...new Set(invoiceIds)]) await refreshInvoiceTotal(id);
}

/** Remove as parcelas de uma despesa e atualiza as faturas afetadas. */
export async function clearInstallments(expenseId: string) {
  const { data, error } = await supabase
    .from("expense_installments")
    .select("card_invoice_id")
    .eq("expense_id", expenseId);
  if (error) throw error;
  const invoiceIds = [...new Set((data ?? []).map((r) => r.card_invoice_id).filter(Boolean))];

  const { error: delError } = await supabase
    .from("expense_installments")
    .delete()
    .eq("expense_id", expenseId);
  if (delError) throw delError;

  for (const id of invoiceIds) await refreshInvoiceTotal(id as string);
}

// ---------- Agregações ----------

export function monthKey(dateIso: string) {
  return dateIso.slice(0, 7);
}

export function currentMonthKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function addMonthsToKey(key: string, months: number) {
  const [y, m] = key.split("-").map(Number);
  const d = new Date(y ?? 1970, (m ?? 1) - 1 + months, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthKeyLabel(key: string) {
  const [y, m] = key.split("-").map(Number);
  return new Date(y ?? 1970, (m ?? 1) - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

/** Soma das parcelas com vencimento em um mês (YYYY-MM). */
export function sumInstallmentsForMonth(installments: ExpenseInstallment[], key: string) {
  return installments
    .filter((i) => i.status === "PENDENTE" && monthKey(i.data_vencimento) === key)
    .reduce((acc, i) => acc + (Number(i.valor_parcela) || 0), 0);
}

/** Próximos meses de compromissos futuros (a partir do mês seguinte). */
export function upcomingInstallmentMonths(installments: ExpenseInstallment[], months = 3) {
  const start = currentMonthKey();
  return Array.from({ length: months }, (_, i) => {
    const key = addMonthsToKey(start, i + 1);
    return { key, label: monthKeyLabel(key), total: sumInstallmentsForMonth(installments, key) };
  });
}
