import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";

export type Budget = Database["public"]["Tables"]["budgets"]["Row"];
export type BudgetInsert = Database["public"]["Tables"]["budgets"]["Insert"];
export type BudgetUpdate = Database["public"]["Tables"]["budgets"]["Update"];
export type BudgetPeriod = Database["public"]["Enums"]["budget_period"];

export const BUDGET_PERIOD_LABELS: Record<BudgetPeriod, string> = {
  MENSAL: "Mensal",
};

export type BudgetStatus = "ok" | "atencao" | "estourado";

export const BUDGET_STATUS_LABELS: Record<BudgetStatus, string> = {
  ok: "Dentro do planejado",
  atencao: "Atenção",
  estourado: "Acima do planejado",
};

/** Verde até 80%, amarelo de 80% a 100%, vermelho acima de 100%. */
export function budgetStatus(percentual: number): BudgetStatus {
  if (percentual > 100) return "estourado";
  if (percentual >= 80) return "atencao";
  return "ok";
}

export const BUDGET_STATUS_CLASSES: Record<BudgetStatus, { badge: string; bar: string }> = {
  ok: { badge: "bg-emerald-500/15 text-emerald-700", bar: "bg-emerald-500" },
  atencao: { badge: "bg-amber-500/15 text-amber-700", bar: "bg-amber-500" },
  estourado: { badge: "bg-red-500/15 text-red-700", bar: "bg-red-500" },
};

export type BudgetPeriodRef = { mes: number; ano: number };

/** Converte "YYYY-MM" em mês/ano de referência. */
export function monthToRef(month: string): BudgetPeriodRef {
  const [ano, mes] = month.split("-").map(Number);
  return { mes: mes ?? 1, ano: ano ?? 1970 };
}

export function refToMonth(ref: BudgetPeriodRef) {
  return `${ref.ano}-${String(ref.mes).padStart(2, "0")}`;
}

export async function fetchBudgets(familyId: string, ref?: BudgetPeriodRef) {
  let query = supabase.from("budgets").select("*").eq("family_id", familyId);
  if (ref) query = query.eq("mes_referencia", ref.mes).eq("ano_referencia", ref.ano);
  const { data, error } = await query.order("created_at", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function createBudget(input: BudgetInsert) {
  const { data, error } = await supabase.from("budgets").insert(input).select().single();
  if (error) throw error;
  return data;
}

export async function updateBudget(id: string, input: BudgetUpdate) {
  const { error } = await supabase.from("budgets").update(input).eq("id", id);
  if (error) throw error;
}

export async function deleteBudget(id: string) {
  const { error } = await supabase.from("budgets").delete().eq("id", id);
  if (error) throw error;
}
