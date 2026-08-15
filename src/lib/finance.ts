import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Income = Database["public"]["Tables"]["incomes"]["Row"];
export type FixedExpense = Database["public"]["Tables"]["fixed_expenses"]["Row"];
export type CreditCard = Database["public"]["Tables"]["credit_cards"]["Row"];
export type IncomeType = Database["public"]["Enums"]["income_type"];
export type IncomeFrequency = Database["public"]["Enums"]["income_frequency"];
export type ExpenseCategory = Database["public"]["Enums"]["expense_category"];
export type ExpenseRecurrence = Database["public"]["Enums"]["expense_recurrence"];

export const INCOME_TYPE_LABELS: Record<IncomeType, string> = {
  FIXA: "Fixa",
  VARIAVEL: "Variável",
};

export const INCOME_FREQUENCY_LABELS: Record<IncomeFrequency, string> = {
  MENSAL: "Mensal",
  SEMANAL: "Semanal",
  QUINZENAL: "Quinzenal",
  ANUAL: "Anual",
  EVENTUAL: "Eventual",
};

export const EXPENSE_CATEGORY_LABELS: Record<ExpenseCategory, string> = {
  ENERGIA: "Energia",
  AGUA: "Água",
  INTERNET: "Internet",
  ALUGUEL: "Aluguel",
  FINANCIAMENTO: "Financiamento",
  ASSINATURAS: "Assinaturas",
  TELEFONE: "Telefone",
  EDUCACAO: "Educação",
  SAUDE: "Saúde",
  TRANSPORTE: "Transporte",
  OUTROS: "Outros",
};

export const EXPENSE_RECURRENCE_LABELS: Record<ExpenseRecurrence, string> = {
  MENSAL: "Mensal",
  BIMESTRAL: "Bimestral",
  TRIMESTRAL: "Trimestral",
  SEMESTRAL: "Semestral",
  ANUAL: "Anual",
};

export function formatCurrency(value: number) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(value || 0);
}

/** Converte um valor de receita para a base mensal equivalente. */
export function monthlyIncomeValue(income: Pick<Income, "valor" | "frequencia">) {
  const valor = Number(income.valor) || 0;
  switch (income.frequencia) {
    case "SEMANAL":
      return valor * 4.345;
    case "QUINZENAL":
      return valor * 2;
    case "ANUAL":
      return valor / 12;
    case "EVENTUAL":
      return 0;
    default:
      return valor;
  }
}

/** Converte uma conta fixa para a base mensal equivalente. */
export function monthlyExpenseValue(expense: Pick<FixedExpense, "valor" | "recorrencia">) {
  const valor = Number(expense.valor) || 0;
  switch (expense.recorrencia) {
    case "BIMESTRAL":
      return valor / 2;
    case "TRIMESTRAL":
      return valor / 3;
    case "SEMESTRAL":
      return valor / 6;
    case "ANUAL":
      return valor / 12;
    default:
      return valor;
  }
}

// ---------- Receitas ----------

export async function fetchIncomes(familyId: string) {
  const { data, error } = await supabase
    .from("incomes")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createIncome(input: Database["public"]["Tables"]["incomes"]["Insert"]) {
  const { data, error } = await supabase.from("incomes").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function toggleIncome(id: string, ativo: boolean) {
  const { error } = await supabase.from("incomes").update({ ativo }).eq("id", id);
  if (error) throw error;
}

export async function deleteIncome(id: string) {
  const { error } = await supabase.from("incomes").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Contas fixas ----------

export async function fetchFixedExpenses(familyId: string) {
  const { data, error } = await supabase
    .from("fixed_expenses")
    .select("*")
    .eq("family_id", familyId)
    .order("vencimento", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createFixedExpense(
  input: Database["public"]["Tables"]["fixed_expenses"]["Insert"],
) {
  const { data, error } = await supabase.from("fixed_expenses").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function toggleFixedExpense(id: string, ativo: boolean) {
  const { error } = await supabase.from("fixed_expenses").update({ ativo }).eq("id", id);
  if (error) throw error;
}

export async function deleteFixedExpense(id: string) {
  const { error } = await supabase.from("fixed_expenses").delete().eq("id", id);
  if (error) throw error;
}

// ---------- Cartões ----------

export async function fetchCreditCards(familyId: string) {
  const { data, error } = await supabase
    .from("credit_cards")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function createCreditCard(
  input: Database["public"]["Tables"]["credit_cards"]["Insert"],
) {
  const { data, error } = await supabase.from("credit_cards").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function toggleCreditCard(id: string, ativo: boolean) {
  const { error } = await supabase.from("credit_cards").update({ ativo }).eq("id", id);
  if (error) throw error;
}

export async function deleteCreditCard(id: string) {
  const { error } = await supabase.from("credit_cards").delete().eq("id", id);
  if (error) throw error;
}
