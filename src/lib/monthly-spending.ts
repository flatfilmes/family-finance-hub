import type { Purchase } from "@/lib/purchases";
import type { RecurringExpense } from "@/lib/recurring-expenses";
import { RECURRENCE_MONTHS } from "@/lib/recurring-expenses";
import { monthlyExpenseValue, type FixedExpense } from "@/lib/finance";

/**
 * Gasto da competência (mês) — regra única do sistema.
 *
 * O gasto de um mês NUNCA usa o valor total de uma compra parcelada:
 * a compra parcelada entra pela parcela daquela competência.
 * Pagamento de fatura também não entra aqui (é movimentação de caixa,
 * o consumo já foi reconhecido quando a compra aconteceu).
 */

export type InstallmentLike = {
  purchase_id?: string | null;
  expense_id?: string;
  numero_parcela: number;
  total_parcelas: number;
  valor_parcela: number | string;
  data_vencimento: string;
  member_id?: string | null;
};

export type SpendingBreakdown = {
  month: string;
  caixa: number;
  cartaoAVista: number;
  parcelasDoMes: number;
  recorrencias: number;
  contasRecorrentes: number;
  total: number;
  /** Parcelas que vencem depois da competência atual. */
  parcelasFuturas: number;
  /** Valor originalmente contratado nas compras parceladas (informação, não gasto do mês). */
  valorContratadoParcelamentos: number;
};

const CAIXA_METHODS = ["PIX", "DEBITO", "DINHEIRO", "TRANSFERENCIA"];

function monthOf(dateIso: string) {
  return dateIso.slice(0, 7);
}

/** Diferença em meses entre duas competências YYYY-MM. */
export function monthsBetween(from: string, to: string) {
  const [fy, fm] = from.split("-").map(Number);
  const [ty, tm] = to.split("-").map(Number);
  return ((ty ?? 0) - (fy ?? 0)) * 12 + ((tm ?? 0) - (fm ?? 0));
}

function isParcelada(p: Purchase) {
  return p.tipo_compra === "COMPRA_PARCELADA" || p.tipo_compra === "PARCELADO";
}

function isRecorrente(p: Purchase) {
  return p.tipo_compra === "COMPRA_RECORRENTE" || p.tipo_compra === "CONTA_RECORRENTE";
}

/** Recorrência ativa naquela competência (uma cobrança por competência). */
function recurringChargeFor(r: RecurringExpense, month: string) {
  const inicio = monthOf(r.data_inicio);
  if (month < inicio) return 0;
  const cancel = r.data_cancelamento ? monthOf(r.data_cancelamento) : null;
  if (cancel && month > cancel) return 0;
  if (!r.ativo && !cancel) return 0;
  const passo = RECURRENCE_MONTHS[r.periodicidade] || 1;
  if (monthsBetween(inicio, month) % passo !== 0) return 0;
  return Number(r.valor) || 0;
}

/**
 * Composição do gasto real de uma competência.
 * Cada consumo aparece uma única vez — sem dupla contagem entre
 * compras, parcelas, recorrências e faturas.
 */
export function buildSpendingBreakdown(input: {
  month: string;
  purchases: Purchase[];
  installments: InstallmentLike[];
  recurring: RecurringExpense[];
  fixed: FixedExpense[];
}): SpendingBreakdown {
  const { month } = input;
  const validas = input.purchases.filter((p) => p.status_pagamento !== "CANCELADO");

  const parceladas = validas.filter(isParcelada);
  const idsParcelados = new Set(parceladas.map((p) => p.id));

  // 1) Saídas diretas de caixa (Pix, débito, dinheiro, transferência) da competência.
  const caixa = validas
    .filter(
      (p) =>
        !idsParcelados.has(p.id) &&
        !isRecorrente(p) &&
        CAIXA_METHODS.includes(p.forma_pagamento) &&
        monthOf(p.data_compra) === month,
    )
    .reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);

  // 2) Compras normais no cartão: o consumo é reconhecido no mês da compra.
  const cartaoAVista = validas
    .filter(
      (p) =>
        !idsParcelados.has(p.id) &&
        !isRecorrente(p) &&
        p.forma_pagamento === "CREDITO" &&
        monthOf(p.data_compra) === month,
    )
    .reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);

  // 3) Compras parceladas: somente a parcela da competência.
  const porCompra = new Map<string, InstallmentLike[]>();
  for (const i of input.installments) {
    if (!i.purchase_id) continue;
    const lista = porCompra.get(i.purchase_id) ?? [];
    lista.push(i);
    porCompra.set(i.purchase_id, lista);
  }

  let parcelasDoMes = 0;
  let parcelasFuturas = 0;
  let valorContratadoParcelamentos = 0;

  for (const compra of parceladas) {
    valorContratadoParcelamentos += Number(compra.valor_total) || 0;
    const lista = (porCompra.get(compra.id) ?? []).slice().sort(
      (a, b) => a.numero_parcela - b.numero_parcela,
    );
    const indice = monthsBetween(monthOf(compra.data_compra), month);
    if (lista.length > 0) {
      const atual = lista.find((p) => p.numero_parcela === indice + 1);
      if (atual) parcelasDoMes += Number(atual.valor_parcela) || 0;
      parcelasFuturas += lista
        .filter((p) => p.numero_parcela > indice + 1)
        .reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0);
    } else {
      // Sem parcelas registradas: divide o contratado pelo número de parcelas conhecido.
      const total = Number(compra.valor_total) || 0;
      const n = Math.max(1, Number(input.installments[0]?.total_parcelas ?? 1));
      const parcela = total / n;
      if (indice >= 0 && indice < n) parcelasDoMes += parcela;
      if (indice + 1 < n) parcelasFuturas += parcela * (n - indice - 1);
    }
  }

  // 4) Recorrências (assinaturas): uma cobrança por competência.
  const recorrencias = input.recurring.reduce((acc, r) => acc + recurringChargeFor(r, month), 0);

  // 5) Contas recorrentes cadastradas (energia, internet, aluguel...).
  const contasRecorrentes = input.fixed
    .filter((f) => f.ativo)
    .reduce((acc, f) => acc + monthlyExpenseValue(f), 0);

  const total = caixa + cartaoAVista + parcelasDoMes + recorrencias + contasRecorrentes;

  return {
    month,
    caixa,
    cartaoAVista,
    parcelasDoMes,
    recorrencias,
    contasRecorrentes,
    total,
    parcelasFuturas,
    valorContratadoParcelamentos,
  };
}
