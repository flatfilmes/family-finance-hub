import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Expense = Database["public"]["Tables"]["expenses"]["Row"];
export type ExpenseInsert = Database["public"]["Tables"]["expenses"]["Insert"];
export type ExpenseUpdate = Database["public"]["Tables"]["expenses"]["Update"];
export type ExpenseCategoryRow = Database["public"]["Tables"]["expense_categories"]["Row"];
export type PurchaseType = Database["public"]["Enums"]["purchase_type"];
export type PaymentMethod = Database["public"]["Enums"]["payment_method"];

export const PURCHASE_TYPE_LABELS: Record<PurchaseType, string> = {
  A_VISTA: "À vista",
  CARTAO_CREDITO: "Cartão de crédito",
  PARCELADO: "Parcelado",
  COMPRA_NORMAL: "Compra normal",
  COMPRA_RECORRENTE: "Compra recorrente",
  COMPRA_PARCELADA: "Compra parcelada",
  CONTA_RECORRENTE: "Conta recorrente",
};

/** Tipos usados no lançamento de despesa avulsa (fluxo antigo, mantido). */
export const EXPENSE_PURCHASE_TYPES: PurchaseType[] = ["A_VISTA", "CARTAO_CREDITO", "PARCELADO"];


export const PAYMENT_METHOD_LABELS: Record<PaymentMethod, string> = {
  DINHEIRO: "Dinheiro",
  PIX: "Pix",
  DEBITO: "Débito",
  CREDITO: "Crédito",
  BOLETO: "Boleto",
  TRANSFERENCIA: "Transferência",
  OUTRO: "Outro",
  A_DEFINIR: "Pagar depois (pagamento pendente)",
};

function parseMonth(month: string): [number, number] {
  const parts = month.split("-").map(Number);
  return [parts[0] ?? 1970, parts[1] ?? 1];
}

export function formatDate(value: string) {
  const parts = value.split("-").map(Number);
  return new Date(parts[0] ?? 1970, (parts[1] ?? 1) - 1, parts[2] ?? 1).toLocaleDateString("pt-BR");
}

/** Retorna o intervalo [inicio, fim] (YYYY-MM-DD) de um mês no formato YYYY-MM. */
export function monthRange(month: string) {
  const [y, m] = parseMonth(month);
  const start = new Date(y, m - 1, 1);
  const end = new Date(y, m, 0);
  const iso = (d: Date) =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  return { start: iso(start), end: iso(end) };
}

export function currentMonth() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function previousMonth(month: string) {
  const [y, m] = parseMonth(month);
  const d = new Date(y, m - 2, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function monthLabel(month: string) {
  const [y, m] = parseMonth(month);
  return new Date(y, m - 1, 1).toLocaleDateString("pt-BR", { month: "long", year: "numeric" });
}

export async function fetchExpenseCategories() {
  const { data, error } = await supabase
    .from("expense_categories")
    .select("*")
    .eq("ativo", true)
    .order("nome", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type ExpenseFilters = {
  month?: string | undefined;
  categoriaId?: string | undefined;
  /** id do membro responsável, ou "sem" para despesas sem responsável */
  memberId?: string | undefined;
  cartaoId?: string | undefined;
};

export async function fetchExpenses(familyId: string, filters: ExpenseFilters = {}) {
  let query = supabase
    .from("expenses")
    .select("*")
    .eq("family_id", familyId)
    .order("data_compra", { ascending: false })
    .order("created_at", { ascending: false });

  if (filters.month) {
    const { start, end } = monthRange(filters.month);
    query = query.gte("data_compra", start).lte("data_compra", end);
  }
  if (filters.categoriaId) query = query.eq("categoria_id", filters.categoriaId);
  if (filters.memberId === "sem") query = query.is("member_id", null);
  else if (filters.memberId) query = query.eq("member_id", filters.memberId);
  if (filters.cartaoId) query = query.eq("cartao_id", filters.cartaoId);

  const { data, error } = await query;
  if (error) throw error;
  return data ?? [];
}

/**
 * LEGADO SOMENTE LEITURA.
 * A tabela `expenses` deixou de ser fonte de verdade: a compra (`purchases`)
 * é a origem de todo consumo. O banco revoga escrita para o app — por isso
 * não existem mais funções de criar, atualizar ou apagar despesa aqui.
 */
