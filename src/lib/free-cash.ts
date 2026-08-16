import type { CardInvoice, ExpenseInstallment } from "@/lib/card-invoices";
import type { FixedExpense, Income } from "@/lib/finance";
import { monthlyExpenseValue, monthlyIncomeValue } from "@/lib/finance";
import type { Purchase } from "@/lib/purchases";
import { RECURRENCE_MONTHS, type RecurringExpense } from "@/lib/recurring-expenses";

/**
 * Motor de obrigações pendentes (sem IA).
 *
 * Regra única: "Comprometido" NÃO é tudo que foi comprado — é somente
 * obrigação financeira ainda em aberto. Por isso:
 * - Pix / débito / dinheiro já saíram do saldo bancário e nunca entram aqui;
 * - fatura paga deixa de ser compromisso;
 * - parcelamento entra pela parcela da competência, nunca pelo valor total;
 * - transferência interna e pagamento de fatura já efetuado não são obrigação.
 */

export type CommitmentsBreakdown = {
  /** Contas recorrentes cadastradas ainda devidas no período. */
  contasRecorrentes: number;
  /** Faturas de cartão não pagas, já descontada a parte de parcelamentos. */
  faturasCartao: number;
  /** Parcelas de compras parceladas que vencem no período. */
  parcelas: number;
  /** Assinaturas/cobranças recorrentes fora do cartão ainda devidas. */
  recorrencias: number;
  /** Boletos pendentes e demais obrigações em aberto. */
  outros: number;
  total: number;
};

export const EMPTY_COMMITMENTS: CommitmentsBreakdown = {
  contasRecorrentes: 0,
  faturasCartao: 0,
  parcelas: 0,
  recorrencias: 0,
  outros: 0,
  total: 0,
};

export function todayIso(d = new Date()) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

function addMonthsIso(dateIso: string, months: number) {
  const [y, m, d] = dateIso.split("-").map(Number);
  const base = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, 1));
  base.setUTCMonth(base.getUTCMonth() + months);
  const last = new Date(Date.UTC(base.getUTCFullYear(), base.getUTCMonth() + 1, 0)).getUTCDate();
  base.setUTCDate(Math.min(d ?? 1, last));
  return base.toISOString().slice(0, 10);
}

export function endOfMonthIso(month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y ?? 1970, m ?? 1, 0).getDate();
  return `${month}-${String(last).padStart(2, "0")}`;
}

/** Data de vencimento de uma conta fixa dentro de uma competência. */
function fixedDueDate(expense: FixedExpense, month: string) {
  const [y, m] = month.split("-").map(Number);
  const last = new Date(y ?? 1970, m ?? 1, 0).getDate();
  const dia = Math.min(Math.max(1, expense.vencimento || 1), last);
  return `${month}-${String(dia).padStart(2, "0")}`;
}

/**
 * Obrigações ainda pendentes numa janela [de, até].
 * `de` normalmente é hoje: o que já foi pago/liquidado não é mais compromisso.
 */
export function buildCommitments(input: {
  from: string;
  to: string;
  month: string;
  fixed: FixedExpense[];
  invoices: CardInvoice[];
  installments: ExpenseInstallment[];
  recurring: RecurringExpense[];
  purchases: Purchase[];
}): CommitmentsBreakdown {
  const { from, to, month } = input;

  // 1) Contas recorrentes (aluguel, energia, escola...) ainda devidas no período.
  const contasRecorrentes = input.fixed
    .filter((f) => f.ativo)
    .filter((f) => {
      const venc = fixedDueDate(f, month);
      return venc >= from && venc <= to;
    })
    .reduce((acc, f) => acc + monthlyExpenseValue(f), 0);

  // 2) Faturas de cartão abertas/fechadas ainda NÃO pagas com vencimento no período.
  const faturasPendentes = input.invoices.filter(
    (i) => i.status !== "PAGA" && i.data_vencimento >= from && i.data_vencimento <= to,
  );
  const idsFatura = new Set(faturasPendentes.map((i) => i.id));
  const totalFaturas = faturasPendentes.reduce((acc, i) => acc + (Number(i.valor_total) || 0), 0);

  // 3) Parcelas da competência: fazem parte da fatura, então são destacadas dela
  //    (nunca somadas por cima — isso seria dupla contagem).
  const parcelas = input.installments
    .filter(
      (p) =>
        p.status === "PENDENTE" &&
        (p.total_parcelas || 1) > 1 &&
        (p.card_invoice_id
          ? idsFatura.has(p.card_invoice_id)
          : p.data_vencimento >= from && p.data_vencimento <= to),
    )
    .reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0);

  const parcelasDentroDaFatura = input.installments
    .filter(
      (p) =>
        p.status === "PENDENTE" &&
        (p.total_parcelas || 1) > 1 &&
        p.card_invoice_id &&
        idsFatura.has(p.card_invoice_id),
    )
    .reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0);

  const faturasCartao = Math.max(0, totalFaturas - parcelasDentroDaFatura);

  // 4) Recorrências fora do cartão (as do cartão já entram pela fatura).
  const recorrencias = input.recurring
    .filter((r) => r.ativo && !r.credit_card_id)
    .filter((r) => {
      const passo = RECURRENCE_MONTHS[r.periodicidade] || 1;
      let data = r.proxima_cobranca;
      let guard = 0;
      while (data < from && guard < 240) {
        data = addMonthsIso(data, passo);
        guard += 1;
      }
      if (r.data_cancelamento && data > r.data_cancelamento) return false;
      return data >= from && data <= to;
    })
    .reduce((acc, r) => acc + (Number(r.valor) || 0), 0);

  // 5) Outros compromissos: boletos e compras registradas sem pagamento realizado.
  //    Enquanto pendente, a compra não saiu do banco — por isso é obrigação.
  //    Quando o pagamento é registrado, ela sai daqui e o saldo já reflete a saída
  //    (nunca as duas coisas ao mesmo tempo).
  const boletos = input.purchases
    .filter((p) => p.status_pagamento === "PENDENTE" && p.forma_pagamento === "BOLETO")
    .filter((p) => p.data_compra <= to)
    .reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);

  const pendentes = input.purchases
    .filter(
      (p) =>
        p.status_pagamento === "PENDENTE_PAGAMENTO" ||
        p.status_pagamento === "PARCIALMENTE_PAGA",
    )
    .filter((p) => (p.data_prevista_pagamento ?? p.data_compra) <= to)
    .reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);

  const outros = boletos + pendentes;

  const total = contasRecorrentes + faturasCartao + parcelas + recorrencias + outros;

  return { contasRecorrentes, faturasCartao, parcelas, recorrencias, outros, total };
}

/** Data efetiva de recebimento no mês informado, respeitando meses curtos. */
export function incomeDayInMonth(dia: number, year: number, monthIndex0: number) {
  const last = new Date(Date.UTC(year, monthIndex0 + 1, 0)).getUTCDate();
  const day = Math.min(Math.max(dia, 1), last);
  return `${year}-${String(monthIndex0 + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Próxima data de recebimento prevista a partir das receitas FIXAS cadastradas. */
export function nextIncomeDate(incomes: Income[], from: string): string | null {
  const datas: string[] = [];
  for (const i of incomes) {
    if (!i.ativo || i.tipo !== "FIXA") continue;
    if (i.frequencia === "EVENTUAL") continue;

    // Receita mensal com dia configurado: usa o dia, ajustando meses curtos.
    if (i.frequencia === "MENSAL" && i.dia_recebimento) {
      const [y, m] = from.split("-").map(Number);
      let data = incomeDayInMonth(i.dia_recebimento, y ?? 1970, (m ?? 1) - 1);
      if (data < from) {
        const nextMonth = new Date(Date.UTC(y ?? 1970, m ?? 1, 1));
        data = incomeDayInMonth(
          i.dia_recebimento,
          nextMonth.getUTCFullYear(),
          nextMonth.getUTCMonth(),
        );
      }
      datas.push(data);
      continue;
    }

    if (!i.data_recebimento) continue;
    const passoDias =
      i.frequencia === "SEMANAL" ? 7 : i.frequencia === "QUINZENAL" ? 15 : null;
    let data = i.data_recebimento;

    let guard = 0;
    if (passoDias) {
      while (data < from && guard < 500) {
        const d = new Date(`${data}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + passoDias);
        data = d.toISOString().slice(0, 10);
        guard += 1;
      }
    } else {
      const passo = i.frequencia === "ANUAL" ? 12 : 1;
      while (data < from && guard < 500) {
        data = addMonthsIso(data, passo);
        guard += 1;
      }
    }
    datas.push(data);
  }
  datas.sort();
  return datas[0] ?? null;
}

/** Renda fixa garantida por mês (nunca considera renda variável como saldo). */
export function guaranteedMonthlyIncome(incomes: Income[]) {
  return incomes
    .filter((i) => i.ativo && i.tipo === "FIXA")
    .reduce((acc, i) => acc + monthlyIncomeValue(i), 0);
}

export type FreeCashStatus = "VERDE" | "AMARELO" | "VERMELHO";

export const FREE_CASH_MESSAGES: Record<FreeCashStatus, string> = {
  VERDE: "Você possui margem para novos gastos.",
  AMARELO: "Sua margem está reduzida. Avalie novos gastos com cuidado.",
  VERMELHO: "Evite novos gastos: seus compromissos já consomem seu saldo disponível.",
};

export const FREE_CASH_CLASSES: Record<FreeCashStatus, { badge: string; dot: string; bar: string }> = {
  VERDE: {
    badge: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
    dot: "bg-emerald-500",
    bar: "bg-emerald-500",
  },
  AMARELO: {
    badge: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
    dot: "bg-amber-500",
    bar: "bg-amber-500",
  },
  VERMELHO: {
    badge: "bg-red-500/15 text-red-700 dark:text-red-400",
    dot: "bg-red-500",
    bar: "bg-red-500",
  },
};

export function freeCashStatus(livre: number, saldo: number): FreeCashStatus {
  if (livre <= 0) return "VERMELHO";
  if (saldo > 0 && livre / saldo < 0.2) return "AMARELO";
  return "VERDE";
}
