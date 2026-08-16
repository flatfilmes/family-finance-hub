import { upcomingInstallmentMonths, type CardInvoice, type ExpenseInstallment } from "@/lib/card-invoices";
import { chargesInMonths, type RecurringExpense } from "@/lib/recurring-expenses";
import type { Purchase } from "@/lib/purchases";
import type { Expense } from "@/lib/expenses";

export type Kind = "normais" | "parceladas" | "recorrentes";

/** Agrupa as compras do cartão por natureza (normal, parcelada, recorrente). */
export function kindOf(tipo: string): Kind {
  if (tipo === "COMPRA_PARCELADA" || tipo === "PARCELADO") return "parceladas";
  if (tipo === "COMPRA_RECORRENTE" || tipo === "CONTA_RECORRENTE") return "recorrentes";
  return "normais";
}

export const KIND_LABELS: Record<Kind, string> = {
  normais: "Normal",
  parceladas: "Parcelada",
  recorrentes: "Recorrente",
};

export type LinhaFatura = {
  id: string;
  data: string;
  estabelecimento: string;
  memberId: string | null;
  categoriaId: string | null;
  kind: Kind;
  parcela: string;
  valor: number;
};

/**
 * Limite utilizado: parcelas em aberto (já sem dupla contagem) + compras
 * comprometidas que ainda não geraram parcela.
 */
export function utilizadoDoCartao(input: {
  utilizadoParcelas: number;
  comprasDoCartao: Purchase[];
  comprasComParcelas: Set<string>;
}) {
  const compras = input.comprasDoCartao
    .filter((p) => p.status_pagamento === "COMPROMETIDO" && !input.comprasComParcelas.has(p.id))
    .reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);
  return input.utilizadoParcelas + compras;
}

/** Linhas da fatura: parcelas ligadas à fatura + compras ainda sem parcela gerada. */
export function linhasDaFatura(input: {
  invoice: CardInvoice | null;
  parcelas: ExpenseInstallment[];
  comprasDoCartao: Purchase[];
  comprasComParcelas: Set<string>;
  despesaPorId: Map<string, Expense>;
  compraPorId: Map<string, Purchase>;
}): LinhaFatura[] {
  const linhas: LinhaFatura[] = [];
  const doInvoice = input.invoice
    ? input.parcelas.filter((p) => p.card_invoice_id === input.invoice!.id)
    : [];

  for (const parcela of doInvoice) {
    const despesa = input.despesaPorId.get(parcela.expense_id);
    const compra = despesa?.purchase_id ? input.compraPorId.get(despesa.purchase_id) : undefined;
    const tipo = (compra?.tipo_compra ?? despesa?.tipo_compra ?? "COMPRA_NORMAL") as string;
    linhas.push({
      id: parcela.id,
      data: compra?.data_compra ?? despesa?.data_compra ?? parcela.data_vencimento,
      estabelecimento: compra?.estabelecimento ?? despesa?.descricao ?? "Lançamento",
      memberId: compra?.member_id ?? despesa?.member_id ?? null,
      categoriaId: despesa?.categoria_id ?? null,
      kind: kindOf(tipo),
      parcela:
        (parcela.total_parcelas || 1) > 1
          ? `${parcela.numero_parcela}/${parcela.total_parcelas}`
          : "—",
      valor: Number(parcela.valor_parcela) || 0,
    });
  }

  for (const compra of input.comprasDoCartao) {
    if (input.comprasComParcelas.has(compra.id)) continue;
    if (compra.status_pagamento !== "COMPROMETIDO") continue;
    linhas.push({
      id: compra.id,
      data: compra.data_compra,
      estabelecimento: compra.estabelecimento,
      memberId: compra.member_id,
      categoriaId: null,
      kind: kindOf(compra.tipo_compra as string),
      parcela: "—",
      valor: Number(compra.valor_total) || 0,
    });
  }

  return linhas.sort((a, b) => (a.data < b.data ? 1 : -1));
}

/**
 * Próximas faturas do cartão: parcelas futuras já registradas + projeção das
 * recorrências ativas. Nunca soma o valor total da compra parcelada.
 */
export function proximasObrigacoes(input: {
  parcelas: ExpenseInstallment[];
  faturas: CardInvoice[];
  recorrencias: RecurringExpense[];
}) {
  const doCartao = input.parcelas.filter(
    (p) => p.status === "PENDENTE" && input.faturas.some((i) => i.id === p.card_invoice_id),
  );
  const base = upcomingInstallmentMonths(doCartao, 3);
  const meses = base.map((m) => m.key);
  const ativas = input.recorrencias.filter((r) => r.ativo);
  // Se a competência já virou parcela registrada, não projeta de novo (evita dupla contagem).
  const jaLancada = (purchaseId: string | null, mes: string) =>
    !!purchaseId &&
    doCartao.some((p) => p.purchase_id === purchaseId && p.data_vencimento.slice(0, 7) === mes);
  return base.map((m) => {
    const recorrente = ativas.reduce(
      (acc, r) =>
        acc + (jaLancada(r.purchase_id, m.key) ? 0 : (chargesInMonths(r, meses)[m.key] ?? 0)),
      0,
    );
    return { ...m, parcelas: m.total, recorrencias: recorrente, total: m.total + recorrente };
  });
}

export type ParcelamentoAtivo = {
  id: string;
  descricao: string;
  numeroAtual: number;
  total: number;
  valorParcela: number;
  restante: number;
};

/** Parcelamentos em andamento no cartão, com saldo futuro comprometido. */
export function parcelamentosAtivos(input: {
  parcelas: ExpenseInstallment[];
  faturas: CardInvoice[];
  despesaPorId: Map<string, Expense>;
  compraPorId: Map<string, Purchase>;
}): ParcelamentoAtivo[] {
  const doCartao = input.parcelas.filter((p) =>
    input.faturas.some((i) => i.id === p.card_invoice_id),
  );
  const porExpense = new Map<string, ExpenseInstallment[]>();
  for (const p of doCartao) {
    if ((p.total_parcelas || 1) <= 1) continue;
    const lista = porExpense.get(p.expense_id) ?? [];
    lista.push(p);
    porExpense.set(p.expense_id, lista);
  }

  const resultado: ParcelamentoAtivo[] = [];
  for (const [expenseId, lista] of porExpense) {
    const ordenadas = lista.slice().sort((a, b) => a.numero_parcela - b.numero_parcela);
    const pendentes = ordenadas.filter((p) => p.status === "PENDENTE");
    if (pendentes.length === 0) continue;
    const atual = pendentes[0]!;
    const despesa = input.despesaPorId.get(expenseId);
    const compra = despesa?.purchase_id ? input.compraPorId.get(despesa.purchase_id) : undefined;
    resultado.push({
      id: expenseId,
      descricao: compra?.estabelecimento ?? despesa?.descricao ?? "Parcelamento",
      numeroAtual: atual.numero_parcela,
      total: atual.total_parcelas,
      valorParcela: Number(atual.valor_parcela) || 0,
      restante: pendentes.reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0),
    });
  }
  return resultado.sort((a, b) => b.restante - a.restante);
}
