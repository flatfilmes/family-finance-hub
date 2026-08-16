import { cycleForDate, iso, parseDate, type Cycle } from "@/lib/card-invoices";
import { RECURRENCE_MONTHS, type RecurringExpense } from "@/lib/recurring-expenses";
import type { CreditCard } from "@/lib/finance";

/**
 * Motor de ocorrências das cobranças recorrentes.
 *
 * Uma recorrência é um cadastro mestre — nunca uma compra nova por mês.
 * Aqui ela é projetada em OCORRÊNCIAS com data real, e cada ocorrência é
 * atribuída ao CICLO do cartão pela regra de fechamento (nunca pelo mês nominal).
 */

export type RecurringOccurrence = {
  id: string;
  recurringId: string;
  nome: string;
  valor: number;
  /** Data real prevista da cobrança. */
  data: string;
  /** Competência do ciclo (mês do vencimento da fatura). */
  competencia: string;
  fechamento: string;
  vencimento: string;
  purchaseId: string | null;
};

function addMonths(dateIso: string, months: number) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const base = new Date(y ?? 1970, (m ?? 1) - 1, 1);
  base.setMonth(base.getMonth() + months);
  const last = new Date(base.getFullYear(), base.getMonth() + 1, 0).getDate();
  base.setDate(Math.min(d ?? 1, last));
  return iso(base);
}

/** Datas reais previstas de uma recorrência dentro de um intervalo fechado. */
export function occurrenceDatesBetween(
  r: Pick<
    RecurringExpense,
    "proxima_cobranca" | "periodicidade" | "ativo" | "data_cancelamento" | "data_inicio"
  >,
  inicio: string,
  fim: string,
): string[] {
  if (!r.ativo && !r.data_cancelamento) return [];
  const passo = RECURRENCE_MONTHS[r.periodicidade] || 1;
  const limite = r.ativo ? null : r.data_cancelamento;
  const datas: string[] = [];
  let data = r.proxima_cobranca || r.data_inicio;
  if (!data) return [];

  // Recorrência com próxima cobrança atrasada: recupera o passo até alcançar a janela.
  let guard = 0;
  while (data < inicio && guard < 480) {
    data = addMonths(data, passo);
    guard += 1;
  }
  guard = 0;
  while (data <= fim && guard < 480) {
    if (limite && data > limite) break;
    if (data >= inicio) datas.push(data);
    data = addMonths(data, passo);
    guard += 1;
  }
  return datas;
}

/** Próxima ocorrência real (>= hoje) de uma recorrência ativa. */
export function nextOccurrenceDate(r: RecurringExpense, hoje = new Date()): string | null {
  if (!r.ativo) return null;
  const hojeIso = iso(hoje);
  const passo = RECURRENCE_MONTHS[r.periodicidade] || 1;
  let data = r.proxima_cobranca || r.data_inicio;
  if (!data) return null;
  let guard = 0;
  while (data < hojeIso && guard < 480) {
    data = addMonths(data, passo);
    guard += 1;
  }
  return data;
}

/** Ciclo do cartão ao qual uma ocorrência pertence (regra de fechamento). */
export function cycleForOccurrence(
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">,
  data: string,
): Cycle {
  return cycleForDate(card, data);
}

/** Início do ciclo quando a fatura não traz a data (deriva do fechamento). */
export function cicloInicio(
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">,
  fechamento: string,
): string {
  const ciclo = cycleForDate(card, parseDate(fechamento));
  return ciclo.data_inicio_ciclo;
}

/**
 * Ocorrências recorrentes que pertencem a UM ciclo do cartão.
 * A janela é o intervalo real do ciclo (dia seguinte ao fechamento anterior
 * até o fechamento), então 07/09 cai em setembro e 14/09 cai em outubro.
 */
export function recurringOccurrencesForCycle(input: {
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">;
  cycle: { data_inicio_ciclo?: string | null; data_fechamento: string; data_vencimento: string };
  recorrencias: RecurringExpense[];
  /** Recorrências já materializadas como parcela/lançamento neste ciclo (não duplicar). */
  jaLancadas?: Set<string>;
}): RecurringOccurrence[] {
  const inicio =
    input.cycle.data_inicio_ciclo || cicloInicio(input.card, input.cycle.data_fechamento);
  const fim = input.cycle.data_fechamento;
  const competencia = input.cycle.data_vencimento.slice(0, 7);
  const resultado: RecurringOccurrence[] = [];

  for (const r of input.recorrencias) {
    if (input.jaLancadas?.has(r.id)) continue;
    if (r.purchase_id && input.jaLancadas?.has(r.purchase_id)) continue;
    for (const data of occurrenceDatesBetween(r, inicio, fim)) {
      resultado.push({
        id: `rec-${r.id}-${data}`,
        recurringId: r.id,
        nome: r.nome,
        valor: Number(r.valor) || 0,
        data,
        competencia,
        fechamento: fim,
        vencimento: input.cycle.data_vencimento,
        purchaseId: r.purchase_id ?? null,
      });
    }
  }
  return resultado.sort((a, b) => (a.data < b.data ? -1 : 1));
}

/** Previsão de cadastro: próxima ocorrência + fatura/ciclo em que ela cairá. */
export function recurringForecast(
  r: RecurringExpense,
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">,
  hoje = new Date(),
) {
  const data = nextOccurrenceDate(r, hoje);
  if (!data) return { data: null, competencia: null as string | null };
  const ciclo = cycleForOccurrence(card, data);
  return { data, competencia: ciclo.data_vencimento.slice(0, 7) };
}
