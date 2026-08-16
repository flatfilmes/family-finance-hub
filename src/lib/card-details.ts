import {
  cycleForDate,
  type CardInvoice,
  type ExpenseInstallment,
} from "@/lib/card-invoices";
import { type RecurringExpense } from "@/lib/recurring-expenses";
import {
  recurringOccurrencesForCycle,
  type RecurringOccurrence,
} from "@/lib/card-recurrences";
import type { Purchase } from "@/lib/purchases";
import type { CreditCard } from "@/lib/finance";
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
  purchaseId: string | null;
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

/**
 * Linhas de um ciclo: parcelas ligadas à fatura (fonte final = card_invoice_id)
 * + compras do cartão ainda sem parcela gerada, associadas pelo ciclo do cartão.
 * A data sozinha nunca decide: ela só serve para derivar o ciclo das compras
 * que ainda não têm entidade de parcela/fatura.
 */
export function linhasDaFatura(input: {
  invoice: CardInvoice | null;
  parcelas: ExpenseInstallment[];
  comprasDoCartao: Purchase[];
  comprasComParcelas: Set<string>;
  despesaPorId: Map<string, Expense>;
  compraPorId: Map<string, Purchase>;
  /** Quando informado, restringe as compras sem parcela ao ciclo da fatura. */
  card?: Pick<CreditCard, "dia_fechamento" | "dia_vencimento"> | null;
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
      purchaseId,
    });
  }

  for (const compra of input.comprasDoCartao) {
    if (input.comprasComParcelas.has(compra.id)) continue;
    if (compra.status_pagamento !== "COMPROMETIDO") continue;
    if (input.card && input.invoice) {
      const ciclo = cycleForDate(input.card, compra.data_compra);
      if (ciclo.data_fechamento !== input.invoice.data_fechamento) continue;
    }
    linhas.push({
      id: compra.id,
      data: compra.data_compra,
      estabelecimento: compra.estabelecimento,
      memberId: compra.member_id,
      categoriaId: null,
      kind: kindOf(compra.tipo_compra as string),
      parcela: "—",
      valor: Number(compra.valor_total) || 0,
      purchaseId: compra.id,
    });
  }

  return linhas.sort((a, b) => (a.data < b.data ? 1 : -1));
}


/**
 * Recorrências que pertencem a um ciclo do cartão, já sem as competências que
 * viraram parcela/lançamento registrado (evita dupla contagem).
 */
export function recorrenciasDoCiclo(input: {
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">;
  invoice: {
    id: string;
    data_inicio_ciclo?: string | null;
    data_fechamento: string;
    data_vencimento: string;
  };
  recorrencias: RecurringExpense[];
  parcelas: ExpenseInstallment[];
}): RecurringOccurrence[] {
  const jaLancadas = new Set<string>();
  for (const p of input.parcelas) {
    if (p.card_invoice_id === input.invoice.id && p.purchase_id) jaLancadas.add(p.purchase_id);
  }
  return recurringOccurrencesForCycle({
    card: input.card,
    cycle: input.invoice,
    recorrencias: input.recorrencias.filter((r) => r.ativo),
    jaLancadas,
  });
}

/**
 * Próximas faturas do cartão: parcelas ainda pendentes de cada ciclo futuro +
 * as ocorrências recorrentes atribuídas ÀQUELE ciclo pela regra de fechamento.
 * Nunca soma o valor total da compra parcelada nem repete o total mensal de
 * recorrências em todos os meses.
 */
export function proximasObrigacoes(input: {
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">;
  parcelas: ExpenseInstallment[];
  faturas: CardInvoice[];
  recorrencias: RecurringExpense[];
  meses?: number;
  hoje?: Date;
}) {
  const hoje = input.hoje ?? new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const futuras = input.faturas
    .filter((i) => i.data_fechamento > hojeIso)
    .sort((a, b) => (a.data_vencimento < b.data_vencimento ? -1 : 1))
    .slice(0, input.meses ?? 3);

  return futuras.map((invoice) => {
    const parcelas = input.parcelas
      .filter((p) => p.card_invoice_id === invoice.id && p.status === "PENDENTE")
      .reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0);
    const ocorrencias = recorrenciasDoCiclo({
      card: input.card,
      invoice,
      recorrencias: input.recorrencias,
      parcelas: input.parcelas,
    });
    const recorrencias = ocorrencias.reduce((acc, o) => acc + o.valor, 0);
    return {
      key: invoice.data_vencimento.slice(0, 7),
      invoiceId: invoice.id,
      parcelas: Math.round(parcelas * 100) / 100,
      recorrencias: Math.round(recorrencias * 100) / 100,
      ocorrencias,
      total: Math.round((parcelas + recorrencias) * 100) / 100,
    };
  });
}

/** Situação de uma parcela dentro da linha do tempo do cartão. */
export type StatusParcela = "PAGA" | "HISTORICA" | "FATURADA" | "EM_FORMACAO" | "PROJETADA";

export type ParcelamentoAtivo = {
  id: string;
  purchaseId: string | null;
  descricao: string;
  numeroAtual: number;
  total: number;
  pagas: number;
  restantesQtd: number;
  valorParcela: number;
  /** Soma somente das parcelas ainda não quitadas. */
  restante: number;
  /** Número da próxima parcela ainda não faturada. */
  proximaParcela: number | null;
  /** Vencimento da próxima parcela — nunca uma data no passado se ainda há futuro. */
  proximaCobranca: string | null;
  statusAtual: StatusParcela;
};

/** Parcelamentos em andamento no cartão, com saldo futuro comprometido. */
export function parcelamentosAtivos(input: {
  parcelas: ExpenseInstallment[];
  faturas: CardInvoice[];
  despesaPorId: Map<string, Expense>;
  compraPorId: Map<string, Purchase>;
  hoje?: Date;
}): ParcelamentoAtivo[] {
  const hoje = input.hoje ?? new Date();
  const hojeIso = `${hoje.getFullYear()}-${String(hoje.getMonth() + 1).padStart(2, "0")}-${String(hoje.getDate()).padStart(2, "0")}`;
  const faturaPorId = new Map(input.faturas.map((i) => [i.id, i]));
  const doCartao = input.parcelas.filter((p) => faturaPorId.has(p.card_invoice_id ?? ""));

  // Uma parcela só é "futura" quando o ciclo dela ainda não fechou.
  const cicloAberto = (p: ExpenseInstallment) => {
    const fatura = faturaPorId.get(p.card_invoice_id ?? "");
    return !!fatura && fatura.status !== "PAGA" && fatura.data_fechamento > hojeIso;
  };

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

    // Parcela atual = a última já faturada (ciclo fechado); próxima = a primeira
    // ainda em formação ou projetada. Nunca a data original da compra.
    const faturadas = pendentes.filter((p) => !cicloAberto(p));
    const futuras = pendentes.filter((p) => cicloAberto(p));
    const atual = faturadas[faturadas.length - 1] ?? futuras[0] ?? pendentes[0]!;
    const proxima = futuras.find((p) => p.numero_parcela > atual.numero_parcela) ?? futuras[0] ?? null;

    const despesa = input.despesaPorId.get(expenseId);
    const purchaseId = lista[0]?.purchase_id ?? despesa?.purchase_id ?? null;
    const compra = purchaseId ? input.compraPorId.get(purchaseId) : undefined;
    const faturaAtual = faturaPorId.get(atual.card_invoice_id ?? "");
    const statusAtual: StatusParcela =
      atual.status === "PAGO"
        ? "PAGA"
        : faturaAtual && faturaAtual.data_fechamento <= hojeIso
          ? faturaAtual.data_vencimento < hojeIso
            ? "HISTORICA"
            : "FATURADA"
          : futuras[0]?.id === atual.id
            ? "EM_FORMACAO"
            : "PROJETADA";

    resultado.push({
      id: expenseId,
      purchaseId,
      descricao: compra?.estabelecimento ?? despesa?.descricao ?? "Parcelamento",
      numeroAtual: atual.numero_parcela,
      total: atual.total_parcelas,
      pagas: ordenadas.filter((p) => p.status === "PAGO").length,
      restantesQtd: pendentes.length,
      valorParcela: Number(atual.valor_parcela) || 0,
      restante: pendentes.reduce((acc, p) => acc + (Number(p.valor_parcela) || 0), 0),
      proximaParcela: proxima?.numero_parcela ?? null,
      proximaCobranca: proxima?.data_vencimento ?? null,
      statusAtual,
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

// ---------- Fatura fechada oficial: evidência do cartão, não das purchases ----------

/** Naturezas do resumo oficial: as três do sistema + taxas e créditos da fatura. */
export type KindOficial = Kind | "taxas" | "creditos";

export const KIND_OFICIAL_LABELS: Record<KindOficial, string> = {
  ...KIND_LABELS,
  taxas: "Taxa/serviço",
  creditos: "Crédito/estorno",
};

/** Lançamento da fatura importada (só o que o resumo oficial precisa ler). */
export type LancamentoOficial = {
  id: string;
  data_lancamento: string | null;
  descricao_original: string;
  estabelecimento_sugerido: string | null;
  valor: number | string;
  tipo_sugerido: string;
  parcela_atual: number | null;
  total_parcelas: number | null;
  categoria_sugerida_id: string | null;
  purchase_id_criada: string | null;
  purchase_id_matched: string | null;
  recurring_expense_id_matched: string | null;
};

export type LinhaOficial = Omit<LinhaFatura, "kind"> & { kind: KindOficial; itemId: string };

/**
 * Linhas da fatura fechada a partir dos lançamentos oficiais.
 *
 * Regra: a fatura é a evidência do cartão. Um lançamento nunca some do resumo
 * porque a `purchase` correspondente ficou em outro ciclo (parcela do meio de
 * uma série, compra anterior ao ciclo etc.). As purchases entram apenas para
 * enriquecer categoria e responsável.
 */
export function linhasOficiaisDaFatura(input: {
  items: LancamentoOficial[];
  vencimento?: string | null;
  compraPorId?: Map<string, Purchase>;
}): LinhaOficial[] {
  return input.items.map((item) => {
    const valor = Number(item.valor) || 0;
    const purchaseId = item.purchase_id_criada ?? item.purchase_id_matched ?? null;
    const compra = purchaseId ? (input.compraPorId?.get(purchaseId) ?? null) : null;
    const kind: KindOficial =
      item.tipo_sugerido === "TAXA" || item.tipo_sugerido === "JUROS"
        ? "taxas"
        : item.tipo_sugerido === "ESTORNO" || valor < 0
          ? "creditos"
          : item.recurring_expense_id_matched
            ? "recorrentes"
            : (item.total_parcelas ?? 1) > 1
              ? "parceladas"
              : "normais";
    return {
      id: item.id,
      itemId: item.id,
      data: item.data_lancamento ?? input.vencimento ?? "",
      estabelecimento: item.estabelecimento_sugerido || item.descricao_original,
      memberId: compra?.member_id ?? null,
      categoriaId: compra?.categoria_id ?? item.categoria_sugerida_id ?? null,
      kind,
      parcela:
        item.parcela_atual && item.total_parcelas
          ? `${item.parcela_atual}/${item.total_parcelas}`
          : "—",
      valor,
      purchaseId,
    };
  });
}

/** Resumo por natureza que precisa fechar exatamente no total oficial da fatura. */
export function resumoOficialDaFatura(linhas: LinhaOficial[]) {
  const soma = (k: KindOficial) =>
    Math.round(
      linhas.filter((l) => l.kind === k).reduce((acc, l) => acc + l.valor, 0) * 100,
    ) / 100;
  const normais = soma("normais");
  const parceladas = soma("parceladas");
  const recorrentes = soma("recorrentes");
  const taxas = soma("taxas");
  const creditos = soma("creditos");
  return {
    normais,
    parceladas,
    recorrentes,
    taxas,
    creditos,
    total: Math.round((normais + parceladas + recorrentes + taxas + creditos) * 100) / 100,
  };
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
  /** Estimativa interna do ciclo (soma das parcelas ligadas à fatura). */
  faturaAtual: number;
  /** Valor oficial do ciclo quando existe importação CONFIRMED. */
  faturaOficial?: number | null;
  parcelasFuturas: number;
  comprasSemParcela: number;
}) {
  const outros =
    input.utilizadoParcelas - input.faturaAtual - input.parcelasFuturas;
  const oficial = input.faturaOficial != null;
  const faturaConsiderada = oficial ? input.faturaOficial! : input.faturaAtual;
  // A diferença entre documento oficial e estimativa entra uma única vez.
  const ajusteOficial = Math.round((faturaConsiderada - input.faturaAtual) * 100) / 100;
  return {
    faturaAtual: faturaConsiderada,
    faturaInterna: input.faturaAtual,
    oficial,
    ajusteOficial,
    parcelasFuturas: input.parcelasFuturas,
    comprasSemParcela: input.comprasSemParcela,
    outros: Math.round(outros * 100) / 100,
    total:
      Math.round(
        (input.utilizadoParcelas + input.comprasSemParcela + ajusteOficial) * 100,
      ) / 100,
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

/** Origem do valor exibido para um ciclo — regra única do sistema. */
export type FonteValorCiclo = "OFFICIAL_STATEMENT" | "ESTIMATED" | "PROJECTED";

export type CicloClassificado<T> = {
  invoice: T;
  competencia: string;
  estado: EstadoCiclo;
  /** true quando o ciclo já se materializou (fechado, pago ou com documento oficial). */
  real: boolean;
  oficial: boolean;
  valor: number;
  fonte: FonteValorCiclo;
  /** Recorrências atribuídas a ESTE ciclo (vazio quando o valor é oficial). */
  recorrencias: RecurringOccurrence[];
};


type InvoiceBase = {
  id: string;
  credit_card_id: string;
  status: string;
  data_inicio_ciclo?: string | null;
  data_fechamento: string;
  data_vencimento: string;
  valor_total: number | string;
};

/** Contexto opcional para projetar recorrências dentro do ciclo. */
type ContextoRecorrencias = {
  card?: Pick<CreditCard, "dia_fechamento" | "dia_vencimento"> | null;
  recorrencias?: RecurringExpense[];
  parcelas?: ExpenseInstallment[];
};

/**
 * REGRA ÚNICA do valor exibido de um ciclo:
 * - importação CONFIRMED do ciclo  => valor oficial da fatura (nunca substituído
 *   por soma de compras/parcelas/recorrências);
 * - ciclo em formação              => estimativa interna + recorrências do ciclo;
 * - ciclos futuros                 => projeção (parcelas + recorrências do ciclo).
 *
 * As recorrências entram pela DATA REAL da ocorrência, atribuída ao ciclo pela
 * regra de fechamento do cartão — nunca pelo mês nominal.
 */
export function getCycleDisplayValue(
  input: {
    cardId: string;
    invoice:
      | {
          id?: string;
          data_inicio_ciclo?: string | null;
          data_vencimento: string;
          data_fechamento: string;
          valor_total: number | string;
        }
      | null;
    imports: ImportacaoFatura[];
    estado: EstadoCiclo;
  } & ContextoRecorrencias,
): {
  valor: number;
  fonte: FonteValorCiclo;
  importId: string | null;
  recorrencias: RecurringOccurrence[];
} {
  const oficial = importacaoOficialDoCiclo(input);
  if (oficial) {
    return {
      valor: Number(oficial.valor_total_fatura) || 0,
      fonte: "OFFICIAL_STATEMENT",
      importId: oficial.id,
      recorrencias: [],
    };
  }
  const ocorrencias =
    input.card && input.invoice
      ? recorrenciasDoCiclo({
          card: input.card,
          invoice: {
            id: input.invoice.id ?? "",
            data_inicio_ciclo: input.invoice.data_inicio_ciclo ?? null,
            data_fechamento: input.invoice.data_fechamento,
            data_vencimento: input.invoice.data_vencimento,
          },
          recorrencias: input.recorrencias ?? [],
          parcelas: input.parcelas ?? [],
        })
      : [];
  const base = Number(input.invoice?.valor_total ?? 0) || 0;
  const recorrente = ocorrencias.reduce((acc, o) => acc + o.valor, 0);
  return {
    valor: Math.round((base + recorrente) * 100) / 100,
    fonte: input.estado === "PROJETADA" ? "PROJECTED" : "ESTIMATED",
    importId: null,
    recorrencias: ocorrencias,
  };
}

/**
 * Classifica os ciclos de um cartão:
 * - fechamento já passou (ou status FECHADA/PAGA, ou importação confirmada) => ciclo real;
 * - primeiro ciclo ainda não fechado => fatura em formação;
 * - demais ciclos futuros => apenas projeção de parcelas, nunca "fatura aberta".
 */
export function classificarCiclosDoCartao<T extends InvoiceBase>(
  input: {
    invoices: T[];
    imports: ImportacaoFatura[];
    hoje?: Date;
  } & ContextoRecorrencias,
): CicloClassificado<T>[] {
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
    const fechou = invoice.data_fechamento <= hojeIso;
    const real = fechou || invoice.status === "FECHADA" || invoice.status === "PAGA" || !!oficialImport;

    let estado: EstadoCiclo;
    if (invoice.status === "PAGA") estado = "PAGA";
    else if (real) estado = invoice.data_vencimento < hojeIso ? "VENCIDA" : "FECHADA";
    else if (!emFormacaoUsada) {
      estado = "EM_FORMACAO";
      emFormacaoUsada = true;
    } else estado = "PROJETADA";

    // Fonte de verdade única — a fatura oficial confirmada sempre prevalece;
    // sem documento oficial, entram parcelas do ciclo + recorrências do ciclo.
    const display = getCycleDisplayValue({
      cardId: invoice.credit_card_id,
      invoice,
      imports: input.imports,
      estado,
      card: input.card,
      recorrencias: input.recorrencias,
      parcelas: input.parcelas,
    });

    return {
      invoice,
      competencia: invoice.data_vencimento.slice(0, 7),
      estado,
      real,
      oficial: !!oficialImport,
      valor: display.valor,
      fonte: display.fonte,
      recorrencias: display.recorrencias,
    };
  });
}

/** Composição auditável de UM ciclo — fonte única de todas as telas. */
export type ComposicaoCiclo = {
  competencia: string;
  estado: EstadoCiclo;
  source: FonteValorCiclo;
  normalPurchases: number;
  installments: number;
  recurringOccurrences: number;
  fees: number;
  credits: number;
  total: number;
  linhas: LinhaOficial[];
  ocorrencias: RecurringOccurrence[];
};

/**
 * buildCardCycleComposition — a ÚNICA função de composição de ciclo.
 *
 * - ciclo com fatura oficial confirmada: a decomposição vem dos lançamentos do
 *   documento e o total é sempre o valor oficial (mudar o tipo de um lançamento
 *   move valor entre naturezas, nunca altera o total);
 * - ciclo em formação/projetado: compras e parcelas do ciclo + ocorrências
 *   recorrentes atribuídas ao ciclo pela regra de fechamento.
 */
export function buildCardCycleComposition(input: {
  ciclo: CicloClassificado<InvoiceBase> | null;
  /** Lançamentos oficiais quando existe importação confirmada do ciclo. */
  itensOficiais?: LancamentoOficial[] | null;
  /** Linhas internas (parcelas + compras do ciclo) quando não há documento oficial. */
  linhasInternas?: LinhaOficial[];
  compraPorId?: Map<string, Purchase>;
}): ComposicaoCiclo {
  const ciclo = input.ciclo;
  const vazio: ComposicaoCiclo = {
    competencia: ciclo?.competencia ?? "",
    estado: ciclo?.estado ?? "PROJETADA",
    source: ciclo?.fonte ?? "PROJECTED",
    normalPurchases: 0,
    installments: 0,
    recurringOccurrences: 0,
    fees: 0,
    credits: 0,
    total: 0,
    linhas: [],
    ocorrencias: [],
  };
  if (!ciclo) return vazio;

  const oficial = ciclo.fonte === "OFFICIAL_STATEMENT" && (input.itensOficiais?.length ?? 0) > 0;

  if (oficial) {
    const linhas = linhasOficiaisDaFatura({
      items: input.itensOficiais!,
      vencimento: ciclo.invoice.data_vencimento,
      compraPorId: input.compraPorId,
    });
    const resumo = resumoOficialDaFatura(linhas);
    return {
      ...vazio,
      source: "OFFICIAL_STATEMENT",
      normalPurchases: resumo.normais,
      installments: resumo.parceladas,
      recurringOccurrences: resumo.recorrentes,
      fees: resumo.taxas,
      credits: resumo.creditos,
      // O total oficial da fatura nunca é substituído pela soma das naturezas.
      total: ciclo.valor,
      linhas,
      ocorrencias: [],
    };
  }

  // Ocorrências recorrentes viram linhas do ciclo (mesma verdade do resumo).
  const linhasRecorrentes: LinhaOficial[] = ciclo.recorrencias.map((o) => ({
    id: o.id,
    itemId: o.id,
    data: o.data,
    estabelecimento: o.nome,
    memberId: null,
    categoriaId: null,
    kind: "recorrentes",
    parcela: "—",
    valor: o.valor,
    purchaseId: o.purchaseId,
  }));
  const linhas = [...(input.linhasInternas ?? []), ...linhasRecorrentes].sort((a, b) =>
    a.data < b.data ? 1 : -1,
  );
  const resumo = resumoOficialDaFatura(linhas);
  return {
    ...vazio,
    source: ciclo.fonte,
    normalPurchases: resumo.normais,
    installments: resumo.parceladas,
    recurringOccurrences: resumo.recorrentes,
    fees: resumo.taxas,
    credits: resumo.creditos,
    total: resumo.total,
    linhas,
    ocorrencias: ciclo.recorrencias,
  };
}


/** Agrupa os ciclos nas seções da página do cartão. */
export function agruparCiclos<T extends InvoiceBase>(ciclos: CicloClassificado<T>[]) {
  const reais = ciclos.filter((c) => c.estado !== "PROJETADA" && c.estado !== "EM_FORMACAO");
  const emFormacao = ciclos.find((c) => c.estado === "EM_FORMACAO") ?? null;
  const projecoes = ciclos.filter((c) => c.estado === "PROJETADA");
  // A fatura atual é o último ciclo real (o mais recente já fechado);
  // ciclos antigos não pagos continuam no histórico marcados como vencidos.
  const atual = reais[reais.length - 1] ?? null;
  const historico = reais.filter((c) => c.invoice.id !== atual?.invoice.id).reverse();
  return { atual, emFormacao, historico, projecoes, reais, todos: ciclos };
}

/**
 * Janela da régua de ciclos: pouco passado, ciclo atual e o futuro comprometido.
 * O futuro só vai até o último mês com obrigação conhecida (parcela/recorrência),
 * evitando dezenas de meses vazios — e o histórico antigo fica sob demanda.
 */
export function janelaDeCiclos<T>(
  ciclos: CicloClassificado<T>[],
  opts?: { passado?: number; futuro?: number; verHistorico?: boolean },
) {
  const passado = opts?.passado ?? 2;
  const futuro = opts?.futuro ?? 9;

  if (ciclos.length === 0) {
    return { visiveis: [], ancora: null, ocultosPassado: 0, ocultosFuturo: 0 };
  }

  const emFormacaoIdx = ciclos.findIndex((c) => c.estado === "EM_FORMACAO");
  let ancoraIdx = emFormacaoIdx;
  if (ancoraIdx < 0) {
    for (let i = 0; i < ciclos.length; i++) {
      if (ciclos[i]!.estado !== "PROJETADA") ancoraIdx = i;
    }
  }
  if (ancoraIdx < 0) ancoraIdx = 0;

  // Último mês futuro com compromisso real conhecido.
  let ultimoRelevante = ancoraIdx;
  for (let i = ancoraIdx + 1; i < ciclos.length; i++) {
    if (ciclos[i]!.valor > 0) ultimoRelevante = i;
  }
  const fim = Math.min(ultimoRelevante, ancoraIdx + futuro) + 1;
  const inicio = opts?.verHistorico ? 0 : Math.max(0, ancoraIdx - passado);

  return {
    visiveis: ciclos.slice(inicio, fim),
    ancora: ciclos[ancoraIdx] ?? null,
    ocultosPassado: inicio,
    ocultosFuturo: Math.max(0, ciclos.length - fim),
  };
}

