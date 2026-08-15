import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { Expense } from "@/lib/expenses";
import { monthlyExpenseValue, monthlyIncomeValue, type FixedExpense, type Income } from "@/lib/finance";

export type FinancialSettings = Database["public"]["Tables"]["financial_settings"]["Row"];

export const DEFAULT_SETTINGS = {
  percentual_reserva: 10,
  limite_alerta_cartao: 70,
};

export async function fetchFinancialSettings(familyId: string) {
  const { data, error } = await supabase
    .from("financial_settings")
    .select("*")
    .eq("family_id", familyId)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function saveFinancialSettings(input: {
  familyId: string;
  percentualReserva: number;
  limiteAlertaCartao: number;
}) {
  const { error } = await supabase.from("financial_settings").upsert(
    {
      family_id: input.familyId,
      percentual_reserva: input.percentualReserva,
      limite_alerta_cartao: input.limiteAlertaCartao,
    },
    { onConflict: "family_id" },
  );
  if (error) throw error;
}

// ---------- Motor de cálculo (sem IA) ----------

export type HealthStatus = "VERDE" | "AMARELO" | "VERMELHO";

export const HEALTH_LABELS: Record<HealthStatus, string> = {
  VERDE: "Saudável",
  AMARELO: "Atenção",
  VERMELHO: "Crítico",
};

export const HEALTH_CLASSES: Record<HealthStatus, { badge: string; bar: string; dot: string }> = {
  VERDE: {
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    bar: "bg-emerald-500",
    dot: "bg-emerald-500",
  },
  AMARELO: {
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    bar: "bg-amber-500",
    dot: "bg-amber-500",
  },
  VERMELHO: {
    badge: "bg-red-500/15 text-red-700 dark:text-red-400",
    bar: "bg-red-500",
    dot: "bg-red-500",
  },
};

/** Receita fixa mensal equivalente. */
export function sumFixedIncome(incomes: Income[]) {
  return incomes
    .filter((i) => i.ativo && i.tipo === "FIXA")
    .reduce((acc, i) => acc + monthlyIncomeValue(i), 0);
}

/** Média mensal estimada das receitas variáveis (eventuais diluídas em 12 meses). */
export function averageVariableIncome(incomes: Income[]) {
  return incomes
    .filter((i) => i.ativo && i.tipo === "VARIAVEL")
    .reduce((acc, i) => {
      const valor = Number(i.valor) || 0;
      return acc + (i.frequencia === "EVENTUAL" ? valor / 12 : monthlyIncomeValue(i));
    }, 0);
}

/** Contas fixas ativas convertidas para base mensal (despesas recorrentes). */
export function sumRecurringExpenses(fixed: FixedExpense[]) {
  return fixed.filter((e) => e.ativo).reduce((acc, e) => acc + monthlyExpenseValue(e), 0);
}

/** Fatura atual dos cartões: despesas do mês pagas no crédito/parceladas. */
export function sumCardInvoices(expenses: Expense[]) {
  return expenses
    .filter(
      (e) =>
        e.tipo_compra === "CARTAO_CREDITO" ||
        e.tipo_compra === "PARCELADO" ||
        e.forma_pagamento === "CREDITO",
    )
    .reduce((acc, e) => acc + (Number(e.valor) || 0), 0);
}

export function healthStatus(input: {
  disponivel: number;
  receita: number;
  compromissos: number;
}): HealthStatus {
  const percentual = input.receita > 0 ? (input.compromissos / input.receita) * 100 : 0;
  if (input.disponivel < 0 || percentual > 100) return "VERMELHO";
  if (percentual > 60) return "AMARELO";
  return "VERDE";
}

export const HEALTH_MESSAGES: Record<HealthStatus, string> = {
  VERDE: "Suas finanças estão equilibradas.",
  AMARELO: "Atenção: sua margem financeira está ficando reduzida.",
  VERMELHO: "Alerta: seus compromissos estão acima da sua capacidade atual.",
};
