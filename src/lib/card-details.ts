import { upcomingInstallmentMonths, type CardInvoice, type ExpenseInstallment } from "@/lib/card-invoices";
import { chargesInMonths, type RecurringExpense } from "@/lib/recurring-expenses";
import type { Purchase } from "@/lib/purchases";
import type { Expense } from "@/lib/expenses";
import { isStatementConfirmed } from "@/lib/card-statements";

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
    // A parcela já aponta para a compra (fonte de verdade); a despesa legada é só fallback.
    const purchaseId = parcela.purchase_id ?? despesa?.purchase_id ?? null;
    const compra = purchaseId ? input.compraPorId.get(purchaseId) : undefined;
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
    const purchaseId = lista[0]?.purchase_id ?? despesa?.purchase_id ?? null;
    const compra = purchaseId ? input.compraPorId.get(purchaseId) : undefined;
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

// ---------- Fonte de verdade da fatura do ciclo ----------

export type FaturaDoCiclo = {
  /** Valor exibido em "Fatura atual" / "Fatura estimada". */
  valor: number;
  /** true quando o valor vem de uma fatura importada e confirmada. */
  oficial: boolean;
  label: "Fatura atual" | "Fatura estimada";
  vencimento: string | null;
  importId: string | null;
};

type ImportacaoFatura = {
  id: string;
  credit_card_id: string;
  status: string;
  valor_total_fatura: number | string | null;
  data_vencimento: string | null;
  data_fechamento: string | null;
  periodo_fim: string | null;
  created_at: string;
};

/**
 * Fatura oficial de um ciclo: a importação CONFIRMADA do mesmo cartão cujo
 * vencimento (ou fechamento/competência) corresponde ao ciclo da fatura interna.
 * Nunca aceita importação de outro ciclo.
 */
export function importacaoOficialDoCiclo(input: {
  cardId: string;
  invoice: { data_vencimento: string; data_fechamento: string } | null;
  imports: ImportacaoFatura[];
}): ImportacaoFatura | null {
  if (!input.invoice) return null;
  const mes = (v?: string | null) => (v ? v.slice(0, 7) : null);
  const candidatas = input.imports
    .filter((i) => i.credit_card_id === input.cardId && isStatementConfirmed(i))
    .filter((i) => {
      if (i.data_vencimento) return i.data_vencimento === input.invoice!.data_vencimento;
      if (i.data_fechamento) return mes(i.data_fechamento) === mes(input.invoice!.data_fechamento);
      return mes(i.periodo_fim) === mes(input.invoice!.data_fechamento);
    })
    .sort((a, b) => (a.created_at < b.created_at ? 1 : -1));
  return candidatas[0] ?? null;
}

/**
 * Hierarquia: fatura oficial importada confirmada > cálculo interno.
 * Quando não existe documento oficial do ciclo, o valor é uma estimativa e o
 * rótulo muda para "Fatura estimada".
 */
export function faturaDoCiclo(input: {
  cardId: string;
  invoice: { data_vencimento: string; data_fechamento: string; valor_total: number | string } | null;
  imports: ImportacaoFatura[];
}): FaturaDoCiclo {
  const oficial = importacaoOficialDoCiclo(input);
  if (oficial) {
    return {
      valor: Number(oficial.valor_total_fatura) || 0,
      oficial: true,
      label: "Fatura atual",
      vencimento: oficial.data_vencimento ?? input.invoice?.data_vencimento ?? null,
      importId: oficial.id,
    };
  }
  return {
    valor: Number(input.invoice?.valor_total ?? 0) || 0,
    oficial: false,
    label: "Fatura estimada",
    vencimento: input.invoice?.data_vencimento ?? null,
    importId: null,
  };
}

export type ObrigacaoAbertaCartao = FaturaDoCiclo & {
  cardId: string;
  invoiceId: string | null;
  aberta: boolean;
};

/**
 * Uma única obrigação aberta por cartão/ciclo. A importação confirmada substitui
 * a estimativa; uma fatura interna paga permanece no histórico, mas vale zero no consolidado.
 */
export function obrigacaoAbertaDoCartao(input: {
  cardId: string;
  invoice: {
    id: string;
    status: string;
    data_vencimento: string;
    data_fechamento: string;
    valor_total: number | string;
  } | null;
  imports: ImportacaoFatura[];
}): ObrigacaoAbertaCartao {
  const fatura = faturaDoCiclo(input);
  const aberta = !!input.invoice && input.invoice.status !== "PAGA";
  return {
    ...fatura,
    valor: aberta ? fatura.valor : 0,
    cardId: input.cardId,
    invoiceId: input.invoice?.id ?? null,
    aberta,
  };
}

/**
 * Composição documentada do limite utilizado:
 *   fatura do ciclo atual
 * + parcelas de ciclos futuros já registradas
 * + parcelas de ciclos anteriores ainda em aberto (atraso)
 * + compras comprometidas no cartão que ainda não viraram parcela
 */
export function composicaoUtilizado(input: {
  utilizadoParcelas: number;
  faturaAtual: number;
  parcelasFuturas: number;
  comprasSemParcela: number;
}) {
  const outros =
    input.utilizadoParcelas - input.faturaAtual - input.parcelasFuturas;
  return {
    faturaAtual: input.faturaAtual,
    parcelasFuturas: input.parcelasFuturas,
    comprasSemParcela: input.comprasSemParcela,
    outros: Math.round(outros * 100) / 100,
    total: input.utilizadoParcelas + input.comprasSemParcela,
  };
}

// ---------- Faturas fechadas e ainda não pagas (fonte única do Dashboard) ----------

export type FaturaFechadaAberta = {
  invoiceId: string;
  cardId: string;
  competencia: string;
  vencimento: string;
  fechamento: string;
  valorOficial: number;
  pago: number;
  restante: number;
  oficial: boolean;
  importId: string | null;
};

/**
 * Fonte de verdade das pendências de fatura: apenas ciclos REAIS já fechados,
 * ainda não pagos e com saldo restante > 0.
 *
 * Regras:
 * - o ciclo precisa estar materializado: importação CONFIRMED do ciclo ou
 *   fatura interna com status FECHADA. Estimativas montadas a partir de
 *   parcelas (status ABERTA, sem documento oficial) nunca entram;
 * - data de fechamento já passou (nada de projeção futura);
 * - fatura PAGA ou saldo restante <= 0 fica de fora;
 * - no máximo uma linha por cartão + ciclo.
 */
export function faturasFechadasEmAberto(input: {
  invoices: {
    id: string;
    credit_card_id: string;
    status: string;
    data_fechamento: string;
    data_vencimento: string;
    valor_total: number | string;
  }[];
  imports: ImportacaoFatura[];
  cardIds?: Set<string>;
  /** Pagamentos confirmados por fatura (opcional). */
  pagamentos?: Map<string, number>;
  hoje?: Date;
}): FaturaFechadaAberta[] {
  const hoje = input.hoje ?? new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const porCiclo = new Map<string, FaturaFechadaAberta>();

  for (const invoice of input.invoices) {
    if (input.cardIds && !input.cardIds.has(invoice.credit_card_id)) continue;
    if (invoice.status === "PAGA") continue;
    if (invoice.data_fechamento > hojeIso) continue;

    const oficial = importacaoOficialDoCiclo({
      cardId: invoice.credit_card_id,
      invoice,
      imports: input.imports,
    });
    const materializada = !!oficial || invoice.status === "FECHADA";
    if (!materializada) continue;

    const valorOficial = oficial
      ? Number(oficial.valor_total_fatura) || 0
      : Number(invoice.valor_total) || 0;
    const pago = input.pagamentos?.get(invoice.id) ?? 0;
    const restante = Math.round((valorOficial - pago) * 100) / 100;
    if (restante <= 0) continue;

    const chave = `${invoice.credit_card_id}|${invoice.data_vencimento.slice(0, 7)}`;
    const atual = porCiclo.get(chave);
    if (atual && atual.restante >= restante) continue;
    porCiclo.set(chave, {
      invoiceId: invoice.id,
      cardId: invoice.credit_card_id,
      competencia: invoice.data_vencimento.slice(0, 7),
      vencimento: invoice.data_vencimento,
      fechamento: invoice.data_fechamento,
      valorOficial,
      pago,
      restante,
      oficial: !!oficial,
      importId: oficial?.id ?? null,
    });
  }

  return [...porCiclo.values()].sort((a, b) => (a.vencimento < b.vencimento ? -1 : 1));
}

// ---------- Ciclos reais x projeções ----------

export type EstadoCiclo = "PAGA" | "VENCIDA" | "FECHADA" | "EM_FORMACAO" | "PROJETADA";

export const ESTADO_CICLO_LABELS: Record<EstadoCiclo, string> = {
  PAGA: "Paga",
  VENCIDA: "Vencida",
  FECHADA: "Fechada",
  EM_FORMACAO: "Em formação",
  PROJETADA: "Projetada",
};

export type CicloClassificado<T> = {
  invoice: T;
  competencia: string;
  estado: EstadoCiclo;
  /** true quando o ciclo já se materializou (fechado, pago ou com documento oficial). */
  real: boolean;
  oficial: boolean;
  valor: number;
};

type InvoiceBase = {
  id: string;
  credit_card_id: string;
  status: string;
  data_fechamento: string;
  data_vencimento: string;
  valor_total: number | string;
};

/**
 * Classifica os ciclos de um cartão:
 * - fechamento já passou (ou status FECHADA/PAGA, ou importação confirmada) => ciclo real;
 * - primeiro ciclo ainda não fechado => fatura em formação;
 * - demais ciclos futuros => apenas projeção de parcelas, nunca "fatura aberta".
 */
export function classificarCiclosDoCartao<T extends InvoiceBase>(input: {
  invoices: T[];
  imports: ImportacaoFatura[];
  hoje?: Date;
}): CicloClassificado<T>[] {
  const hoje = input.hoje ?? new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const ordenadas = input.invoices
    .slice()
    .sort((a, b) => (a.data_vencimento < b.data_vencimento ? -1 : 1));

  let emFormacaoUsada = false;
  return ordenadas.map((invoice) => {
    const oficialImport = importacaoOficialDoCiclo({
      cardId: invoice.credit_card_id,
      invoice,
      imports: input.imports,
    });
    const valor = oficialImport
      ? Number(oficialImport.valor_total_fatura) || 0
      : Number(invoice.valor_total) || 0;
    const fechou = invoice.data_fechamento <= hojeIso;
    const real = fechou || invoice.status === "FECHADA" || invoice.status === "PAGA" || !!oficialImport;

    let estado: EstadoCiclo;
    if (invoice.status === "PAGA") estado = "PAGA";
    else if (real) estado = invoice.data_vencimento < hojeIso ? "VENCIDA" : "FECHADA";
    else if (!emFormacaoUsada) {
      estado = "EM_FORMACAO";
      emFormacaoUsada = true;
    } else estado = "PROJETADA";

    return {
      invoice,
      competencia: invoice.data_vencimento.slice(0, 7),
      estado,
      real,
      oficial: !!oficialImport,
      valor,
    };
  });
}

/** Agrupa os ciclos nas seções da página do cartão. */
export function agruparCiclos<T extends InvoiceBase>(ciclos: CicloClassificado<T>[]) {
  const reais = ciclos.filter((c) => c.estado !== "PROJETADA" && c.estado !== "EM_FORMACAO");
  const emFormacao = ciclos.find((c) => c.estado === "EM_FORMACAO") ?? null;
  const projecoes = ciclos.filter((c) => c.estado === "PROJETADA");
  const emAberto = reais.filter((c) => c.estado !== "PAGA");
  const atual = emAberto[0] ?? reais[reais.length - 1] ?? null;
  const historico = reais.filter((c) => c.invoice.id !== atual?.invoice.id).reverse();
  return { atual, emFormacao, historico, projecoes, reais };
}
