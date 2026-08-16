/**
 * AUDITORIA DA CONTA BANCÁRIA — somente leitura.
 *
 * Nada é criado, corrigido ou ajustado aqui. O motor compara três fontes:
 *
 *   1. o DOCUMENTO (extratos importados: período, saldo inicial, saldo final,
 *      "Saldo do dia" e os lançamentos lidos do PDF);
 *   2. o LEDGER (`transactions` da conta);
 *   3. os CHECKPOINTS de saldo informados pelo banco.
 *
 * Princípios corrigidos nesta versão:
 *  - cobertura de período vem de period_start/period_end do DOCUMENTO, nunca
 *    da primeira/última transação (dia sem movimento não é lacuna);
 *  - o diagnóstico começa pela PRIMEIRA divergência cronológica, não pelo
 *    saldo final do mês;
 *  - cada mês recebe um status específico (nunca "crítico" genérico);
 *  - a quantidade de movimentos do PDF é comparada com a do ledger e os
 *    lançamentos faltantes são listados um a um;
 *  - datas: a data contábil é a do lançamento do extrato; datas dentro do
 *    histórico são metadata e apenas sinalizam inconsistência.
 */
import type { Transaction } from "@/lib/transactions";
import { movementEffect } from "@/lib/bank-ledger";

export type Severity = "CRITICO" | "ATENCAO" | "PENDENCIA" | "INFORMATIVO";

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICO: "Crítico",
  ATENCAO: "Atenção",
  PENDENCIA: "Pendência",
  INFORMATIVO: "Informativo",
};

export const SEVERITY_TONES: Record<Severity, "danger" | "warn" | "info" | "muted"> = {
  CRITICO: "danger",
  ATENCAO: "warn",
  PENDENCIA: "info",
  INFORMATIVO: "muted",
};

/** Situação de um mês auditado — específica, nunca genérica. */
export type MonthStatus =
  | "VALIDADO_COMPLETO"
  | "VALIDADO_MENSAL"
  | "CHECKPOINTS_INCOMPLETOS"
  | "CHECKPOINTS_AUSENTES"
  | "MOVIMENTOS_INCOMPLETOS"
  | "DIVERGENCIA_DIARIA"
  | "DIVERGENCIA_FINAL"
  | "DATAS_INCONSISTENTES"
  | "INVALID_MATCHES"
  | "SOURCE_FILE_MISSING"
  | "SEM_EXTRATO";

export const MONTH_STATUS_LABELS: Record<MonthStatus, string> = {
  VALIDADO_COMPLETO: "Validado (dia a dia)",
  VALIDADO_MENSAL: "Validado só no mês",
  CHECKPOINTS_INCOMPLETOS: "Checkpoints incompletos",
  CHECKPOINTS_AUSENTES: "Checkpoints ausentes",
  MOVIMENTOS_INCOMPLETOS: "Movimentos incompletos",
  DIVERGENCIA_DIARIA: "Divergência diária",
  DIVERGENCIA_FINAL: "Divergência no fechamento",
  DATAS_INCONSISTENTES: "Datas inconsistentes",
  INVALID_MATCHES: "Associações inválidas",
  SOURCE_FILE_MISSING: "PDF de origem ausente",
  SEM_EXTRATO: "Sem extrato importado",
};

export const MONTH_STATUS_TONES: Record<MonthStatus, "ok" | "danger" | "warn" | "info" | "muted"> =
  {
    VALIDADO_COMPLETO: "ok",
    VALIDADO_MENSAL: "warn",
    CHECKPOINTS_INCOMPLETOS: "warn",
    CHECKPOINTS_AUSENTES: "info",
    MOVIMENTOS_INCOMPLETOS: "danger",
    DIVERGENCIA_DIARIA: "danger",
    DIVERGENCIA_FINAL: "danger",
    DATAS_INCONSISTENTES: "warn",
    INVALID_MATCHES: "warn",
    SOURCE_FILE_MISSING: "info",
    SEM_EXTRATO: "muted",
  };

/** Integridade financeira x qualidade de dados: nunca no mesmo balde. */
export type IssueCategory = "FINANCEIRA" | "DADOS";

export const ISSUE_CATEGORY_LABELS: Record<IssueCategory, string> = {
  FINANCEIRA: "Integridade financeira",
  DADOS: "Qualidade de dados",
};

export type AuditIssue = {
  id: string;
  severity: Severity;
  /** FINANCEIRA afeta saldo; DADOS é enriquecimento e não invalida o mês. */
  categoria: IssueCategory;
  titulo: string;
  detalhe: string;
  referencia?: string;
};

export type StatementPeriod = {
  id: string;
  nomeArquivo: string;
  inicio: string | null;
  fim: string | null;
  saldoInicial: number | null;
  saldoFinal: number | null;
  quantidade: number;
  status: string;
};

export type ContinuityLink = {
  anterior: StatementPeriod;
  proximo: StatementPeriod;
  saldoFinalAnterior: number | null;
  saldoInicialProximo: number | null;
  diferenca: number | null;
  confere: boolean;
  /** Dias sem NENHUM extrato cobrindo o intervalo (period_end → period_start). */
  lacuna: { inicio: string; fim: string; dias: number } | null;
  sobreposicao: boolean;
};

/** Lançamento lido do PDF que a auditoria não encontrou no ledger. */
export type MissingMovement = {
  itemId: string;
  data: string | null;
  descricao: string;
  valor: number;
  motivo: string;
};

/** Divergência entre a data contábil do extrato e a data gravada no ledger. */
export type DateMismatch = {
  itemId: string;
  transactionId: string;
  descricao: string;
  valor: number;
  dataExtrato: string | null;
  dataLedger: string;
  /** Data encontrada dentro do texto do histórico (metadata, não contábil). */
  dataNoHistorico: string | null;
  diasDeDiferenca: number | null;
  /** Fora da tolerância de conciliação: associação automática inválida. */
  invalido: boolean;
};

export type AuditDay = {
  date: string;
  openingBalance: number;
  /** Entradas DO DIA (não acumuladas). */
  inflows: number;
  /** Saídas DO DIA (não acumuladas). */
  outflows: number;
  /** Acumulado do mês até este dia — útil para conferir a cronologia. */
  inflowsAcumuladas: number;
  outflowsAcumuladas: number;
  calculated: number;
  reported: number | null;
  difference: number | null;
  confere: boolean | null;
  /** Sem "Saldo do dia" no documento: o saldo existe, mas não foi conferido. */
  origem: "CHECKPOINT" | "CALCULATED_ONLY";
  transactions: Transaction[];
};

export type AuditMonth = {
  key: string;
  status: MonthStatus;
  imports: StatementPeriod[];
  openingBalance: number | null;
  inflows: number;
  outflows: number;
  calculated: number;
  reported: number | null;
  difference: number | null;
  confere: boolean | null;
  /** Diferença entre o saldo informado e o calculado — valor não identificado. */
  missingAmount: number | null;
  ajustes: Transaction[];
  days: AuditDay[];
  quantidade: number;
  /** Quantidade de lançamentos lidos do PDF neste mês. */
  movimentosPdf: number;
  /** Quantidade de movimentos considerados no ledger. */
  movimentosLedger: number;
  diferencaMovimentos: number;
  faltantes: MissingMovement[];
  datasInconsistentes: DateMismatch[];
  /** Subconjunto acima da tolerância — precisa ser desfeito no reprocessamento. */
  associacoesInvalidas: DateMismatch[];
  /** Checkpoints persistidos neste mês. */
  checkpoints: number;
  /** "Saldo do dia" encontrados no PDF deste mês (evidência do documento). */
  checkpointsPdf: number;
  /** Checkpoints persistidos que batem com o saldo calculado. */
  checkpointsConferem: number;
  /** Primeiro dia com checkpoint em que calculado ≠ informado. */
  primeiraDivergencia: {
    date: string;
    calculado: number;
    informado: number;
    diferenca: number;
    ultimoDiaCorreto: string | null;
    movimentosDesdeUltimoCorreto: Transaction[];
  } | null;
};

export type DuplicateGroup = {
  key: string;
  date: string;
  descricao: string;
  valor: number;
  direcao: "IN" | "OUT";
  ids: string[];
};

export type PendingItem = {
  transaction: Transaction;
  motivo: string;
};

export type TransferHint = {
  saida: Transaction;
  entrada: Transaction;
  contaDestino: string;
};

export type StatementItemInput = {
  id: string;
  import_id: string;
  data_movimento: string | null;
  descricao_original: string;
  valor: number | string;
  incluir?: boolean | null;
  review_action?: string | null;
  transaction_id_criada?: string | null;
  transaction_id_matched?: string | null;
  /** Compras criadas/associadas pelo extrato: o ledger nasce delas por gatilho. */
  purchase_id_criada?: string | null;
  purchase_id_matched?: string | null;
};

export type BankAudit = {
  periodoInicio: string | null;
  periodoFim: string | null;
  extratos: StatementPeriod[];
  continuidade: ContinuityLink[];
  meses: AuditMonth[];
  duplicidades: DuplicateGroup[];
  semAssociacao: PendingItem[];
  semCategoria: PendingItem[];
  pagamentosCartaoSemFatura: Transaction[];
  transferenciasProvaveis: TransferHint[];
  /** Todas as inconsistências de data encontradas na conta. */
  datasInconsistentes: DateMismatch[];
  referenciaManual: {
    saldoInformado: number;
    data: string;
    saldoCalculado: number | null;
    diferenca: number | null;
    coberto: boolean;
    diasFaltando: number;
  } | null;
  resumo: {
    extratos: number;
    mesesComContinuidade: number;
    totalTransicoes: number;
    mesesValidados: number;
    totalMeses: number;
    mesesComDivergencia: number;
    mesesSemCheckpoint: number;
    diasComDivergencia: number;
    checkpoints: number;
    movimentosPdf: number;
    movimentosLedger: number;
    faltantes: number;
    datasInconsistentes: number;
    associacoesInvalidas: number;
    semAssociacao: number;
    semCategoria: number;
    lacunas: number;
    sobreposicoes: number;
    duplicidades: number;
  };
  problemas: AuditIssue[];
};

const arredonda = (v: number) => Math.round(v * 100) / 100;

/** DATA É CRITÉRIO FORTE: acima disso a associação automática é inválida. */
export const TOLERANCIA_MATCH_DIAS = 2;
const CONFERE = 0.02;

/** Posição patrimonial: não é entrada nem saída do período. */
const POSTURA = ["ABERTURA_SALDO", "AJUSTE_SALDO"];

/** Ações de revisão que, por decisão do usuário, não geram nada no ledger. */
const SEM_EFEITO = ["IGNORE"];

function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDays(iso: string, dias: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string) {
  const ms = new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime();
  return Math.round(ms / 86400000);
}

/**
 * Data escondida no texto do histórico (ex.: "Pix - Enviado 26/01 12:45").
 * É METADATA: nunca substitui a data contábil, apenas sinaliza inconsistência.
 */
function dataNoHistorico(descricao: string, anoBase: string): string | null {
  const m = descricao.match(/(\d{2})\/(\d{2})(?:\/(\d{2,4}))?/);
  if (!m) return null;
  const dia = m[1]!;
  const mes = m[2]!;
  const ano = m[3] ? (m[3].length === 2 ? `20${m[3]}` : m[3]) : anoBase;
  const iso = `${ano}-${mes}-${dia}`;
  return /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/.test(iso) ? iso : null;
}

export function buildBankAudit(input: {
  accountId: string;
  transactions: Transaction[];
  imports: {
    id: string;
    nome_arquivo: string;
    periodo_inicio: string | null;
    periodo_fim: string | null;
    saldo_inicial: number | string | null;
    saldo_final: number | string | null;
    quantidade_lancamentos: number | null;
    status: string;
  }[];
  checkpoints: { data: string; saldo: number }[];
  /** Lançamentos lidos dos PDFs — evidência do documento. */
  statementItems?: StatementItemInput[];
  /** Compras vinculadas, para saber o que está sem categoria. */
  purchases?: { id: string; categoria_id: string | null }[];
  /** Faturas de cartão existentes na família. */
  cardInvoiceIds?: string[];
  /** Contas da família, para sugerir transferências internas. */
  accounts?: { id: string; nome_conta: string }[];
  /** Saldo de referência informado pelo titular (cadastro da conta). */
  saldoReferencia?: { saldo: number; data: string } | null;
}): BankAudit {
  const extratos: StatementPeriod[] = input.imports
    .filter((i) => i.status !== "CANCELLED" && i.status !== "ERROR")
    .map((i) => ({
      id: i.id,
      nomeArquivo: i.nome_arquivo,
      inicio: i.periodo_inicio,
      fim: i.periodo_fim,
      saldoInicial: i.saldo_inicial === null ? null : Number(i.saldo_inicial),
      saldoFinal: i.saldo_final === null ? null : Number(i.saldo_final),
      quantidade: i.quantidade_lancamentos ?? 0,
      status: i.status,
    }))
    .sort((a, b) => String(a.inicio ?? "").localeCompare(String(b.inicio ?? "")));

  const daConta = input.transactions
    .filter((t) => t.bank_account_id === input.accountId && t.status !== "CANCELADA")
    .sort(
      (a, b) =>
        a.data_movimento.localeCompare(b.data_movimento) ||
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
    );
  const porId = new Map(daConta.map((t) => [t.id, t]));
  // Compra vira ledger por gatilho: o vínculo do item pode ser pela compra.
  const porCompra = new Map<string, Transaction>();
  for (const t of daConta) if (t.purchase_id && !porCompra.has(t.purchase_id)) porCompra.set(t.purchase_id, t);

  const periodoInicio = extratos.find((e) => e.inicio)?.inicio ?? daConta[0]?.data_movimento ?? null;
  const periodoFim =
    [...extratos].reverse().find((e) => e.fim)?.fim ??
    daConta[daConta.length - 1]?.data_movimento ??
    null;

  // ---------- continuidade e cobertura de período ----------
  // A cobertura vem SEMPRE do documento (period_start → period_end).
  const comPeriodo = extratos.filter((e) => e.inicio && e.fim);
  const continuidade: ContinuityLink[] = [];
  for (let i = 1; i < comPeriodo.length; i++) {
    const anterior = comPeriodo[i - 1]!;
    const proximo = comPeriodo[i]!;
    const diferenca =
      anterior.saldoFinal === null || proximo.saldoInicial === null
        ? null
        : arredonda(proximo.saldoInicial - anterior.saldoFinal);
    const sobreposicao = proximo.inicio! <= anterior.fim!;

    // Extratos mensais consecutivos cobrem o mês inteiro mesmo quando o PDF
    // começa no primeiro dia COM movimento. Só há lacuna real quando falta um
    // mês inteiro entre os dois documentos.
    const mesAnterior = anterior.fim!.slice(0, 7);
    const mesProximo = proximo.inicio!.slice(0, 7);
    const mesesDeDistancia =
      (Number(mesProximo.slice(0, 4)) - Number(mesAnterior.slice(0, 4))) * 12 +
      (Number(mesProximo.slice(5, 7)) - Number(mesAnterior.slice(5, 7)));
    const gapInicio = addDays(anterior.fim!, 1);
    const temLacuna = !sobreposicao && mesesDeDistancia > 1;

    continuidade.push({
      anterior,
      proximo,
      saldoFinalAnterior: anterior.saldoFinal,
      saldoInicialProximo: proximo.saldoInicial,
      diferenca,
      confere: diferenca !== null && Math.abs(diferenca) <= CONFERE,
      lacuna: temLacuna
        ? {
            inicio: gapInicio,
            fim: addDays(proximo.inicio!, -1),
            dias: diffDays(gapInicio, proximo.inicio!),
          }
        : null,
      sobreposicao,
    });
  }

  // ---------- evidência do documento (itens lidos do PDF) ----------
  const itens = (input.statementItems ?? []).filter(
    (i) => !SEM_EFEITO.includes(String(i.review_action ?? "")),
  );
  const itensPorMes = new Map<string, StatementItemInput[]>();
  for (const it of itens) {
    if (!it.data_movimento) continue;
    const key = it.data_movimento.slice(0, 7);
    itensPorMes.set(key, [...(itensPorMes.get(key) ?? []), it]);
  }

  const datasInconsistentes: DateMismatch[] = [];
  const faltantesPorMes = new Map<string, MissingMovement[]>();
  const mismatchPorMes = new Map<string, DateMismatch[]>();

  for (const it of itens) {
    const mes = it.data_movimento?.slice(0, 7) ?? "";
    const valor = Number(it.valor) || 0;
    const compra = it.purchase_id_criada ?? it.purchase_id_matched ?? null;
    const ligada = it.transaction_id_criada ?? it.transaction_id_matched ?? null;
    const tx =
      (ligada ? porId.get(ligada) : undefined) ??
      (compra ? porCompra.get(compra) : undefined) ??
      null;

    if (!tx) {
      faltantesPorMes.set(mes, [
        ...(faltantesPorMes.get(mes) ?? []),
        {
          itemId: it.id,
          data: it.data_movimento,
          descricao: it.descricao_original,
          valor,
          motivo:
            ligada || compra
              ? "Vinculado a um registro que não existe mais no ledger desta conta."
              : "Lido no PDF, mas sem movimentação correspondente no ledger.",
        },
      ]);
      continue;
    }

    if (it.data_movimento && tx.data_movimento !== it.data_movimento) {
      const mismatch: DateMismatch = {
        itemId: it.id,
        transactionId: tx.id,
        descricao: it.descricao_original,
        valor,
        dataExtrato: it.data_movimento,
        dataLedger: tx.data_movimento,
        dataNoHistorico: dataNoHistorico(it.descricao_original, it.data_movimento.slice(0, 4)),
        diasDeDiferenca: diffDays(it.data_movimento, tx.data_movimento),
        invalido:
          Math.abs(diffDays(it.data_movimento, tx.data_movimento)) > TOLERANCIA_MATCH_DIAS,
      };
      datasInconsistentes.push(mismatch);
      mismatchPorMes.set(mes, [...(mismatchPorMes.get(mes) ?? []), mismatch]);
    }
  }

  // ---------- auditoria mensal e diária ----------
  const checkpointPorDia = new Map(input.checkpoints.map((c) => [c.data, c.saldo]));
  const mesesKeys = new Set<string>();
  for (const e of comPeriodo) mesesKeys.add(e.inicio!.slice(0, 7));
  for (const t of daConta) mesesKeys.add(t.data_movimento.slice(0, 7));

  const meses: AuditMonth[] = [...mesesKeys].sort().map((key) => {
    const doMes = daConta.filter((t) => t.data_movimento.slice(0, 7) === key);
    // Um extrato cobre o mês quando o período do documento o intersecta —
    // não apenas quando começa nele.
    const importsDoMes = comPeriodo.filter(
      (e) => e.inicio!.slice(0, 7) <= key && (e.fim ?? e.inicio!).slice(0, 7) >= key,
    );
    const abertura = importsDoMes[0]?.saldoInicial ?? null;
    const reported = importsDoMes[importsDoMes.length - 1]?.saldoFinal ?? null;

    const ajustes = doMes.filter((t) => POSTURA.includes(t.tipo));
    const movimentos = doMes.filter((t) => !POSTURA.includes(t.tipo));

    const porDia = new Map<string, Transaction[]>();
    for (const t of movimentos) {
      const lista = porDia.get(t.data_movimento) ?? [];
      lista.push(t);
      porDia.set(t.data_movimento, lista);
    }

    let saldo = abertura ?? 0;
    let inflows = 0;
    let outflows = 0;
    const days: AuditDay[] = [...porDia.keys()].sort().map((date) => {
      const lista = porDia.get(date)!;
      const entradas = arredonda(lista.reduce((acc, t) => acc + Math.max(movementEffect(t), 0), 0));
      const saidas = arredonda(lista.reduce((acc, t) => acc + Math.max(-movementEffect(t), 0), 0));
      const openingBalance = saldo;
      const calculated = arredonda(openingBalance + entradas - saidas);
      saldo = calculated;
      inflows = arredonda(inflows + entradas);
      outflows = arredonda(outflows + saidas);
      const informado = checkpointPorDia.get(date) ?? null;
      const difference = informado === null ? null : arredonda(informado - calculated);
      return {
        date,
        openingBalance,
        inflows,
        outflows,
        calculated,
        reported: informado,
        difference,
        confere: difference === null ? null : Math.abs(difference) <= CONFERE,
        transactions: lista,
      };
    });

    const calculated = arredonda((abertura ?? 0) + inflows - outflows);
    const difference = reported === null ? null : arredonda(reported - calculated);
    const confere = difference === null ? null : Math.abs(difference) <= CONFERE;

    // ---------- primeira divergência cronológica ----------
    let primeiraDivergencia: AuditMonth["primeiraDivergencia"] = null;
    let ultimoCorreto: string | null = null;
    for (const d of days) {
      if (d.confere === true) {
        ultimoCorreto = d.date;
        continue;
      }
      if (d.confere === false) {
        primeiraDivergencia = {
          date: d.date,
          calculado: d.calculated,
          informado: d.reported ?? 0,
          diferenca: d.difference ?? 0,
          ultimoDiaCorreto: ultimoCorreto,
          movimentosDesdeUltimoCorreto: days
            .filter((x) => (ultimoCorreto ? x.date > ultimoCorreto : true) && x.date <= d.date)
            .flatMap((x) => x.transactions),
        };
        break;
      }
    }

    const checkpointsDoMes = input.checkpoints.filter((c) => c.data.slice(0, 7) === key).length;
    const movimentosPdf = (itensPorMes.get(key) ?? []).length;
    const faltantes = faltantesPorMes.get(key) ?? [];
    const mismatches = mismatchPorMes.get(key) ?? [];

    const invalidas = mismatches.filter((m) => m.invalido);

    // Ordem de diagnóstico: primeiro o que quebra o saldo, depois o que só
    // atrapalha a leitura. Categoria e associação nunca invalidam o mês.
    const status: MonthStatus = !importsDoMes.length
      ? "SEM_EXTRATO"
      : faltantes.length
        ? "MOVIMENTOS_INCOMPLETOS"
        : invalidas.length
          ? "INVALID_MATCHES"
          : primeiraDivergencia
            ? "DIVERGENCIA_DIARIA"
            : confere === false
              ? "DIVERGENCIA_FINAL"
              : checkpointsDoMes === 0
                ? "CHECKPOINTS_AUSENTES"
                : mismatches.length
                  ? "DATAS_INCONSISTENTES"
                  : "VALIDADO";

    return {
      key,
      status,
      imports: importsDoMes,
      openingBalance: abertura,
      inflows,
      outflows,
      calculated,
      reported,
      difference,
      confere,
      missingAmount: difference !== null && Math.abs(difference) > CONFERE ? difference : null,
      ajustes,
      days,
      quantidade: movimentos.length,
      movimentosPdf,
      movimentosLedger: movimentos.length,
      diferencaMovimentos: movimentos.length - movimentosPdf,
      faltantes,
      datasInconsistentes: mismatches,
      associacoesInvalidas: invalidas,
      checkpoints: checkpointsDoMes,
      primeiraDivergencia,
    };
  });

  // ---------- duplicidades ----------
  const grupos = new Map<string, Transaction[]>();
  for (const t of daConta) {
    if (POSTURA.includes(t.tipo)) continue;
    const efeito = movementEffect(t);
    const key = [
      t.data_movimento,
      Math.abs(Number(t.valor)).toFixed(2),
      efeito >= 0 ? "IN" : "OUT",
      normalizar(t.descricao ?? ""),
    ].join("|");
    grupos.set(key, [...(grupos.get(key) ?? []), t]);
  }
  const duplicidades: DuplicateGroup[] = [...grupos.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([key, lista]) => ({
      key,
      date: lista[0]!.data_movimento,
      descricao: lista[0]!.descricao ?? "",
      valor: Math.abs(Number(lista[0]!.valor)),
      direcao: movementEffect(lista[0]!) >= 0 ? ("IN" as const) : ("OUT" as const),
      ids: lista.map((t) => t.id),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // ---------- associação e categoria ----------
  const categoriaPorCompra = new Map(
    (input.purchases ?? []).map((p) => [p.id, p.categoria_id ?? null]),
  );
  const semAssociacao: PendingItem[] = [];
  const semCategoria: PendingItem[] = [];
  const pagamentosCartaoSemFatura: Transaction[] = [];
  const invoiceIds = new Set(input.cardInvoiceIds ?? []);

  for (const t of daConta) {
    if (POSTURA.includes(t.tipo)) continue;
    const extra = t as Transaction & {
      transfer_group_id?: string | null;
      natureza?: string | null;
    };
    const associado =
      !!t.purchase_id ||
      !!t.income_id ||
      !!t.card_invoice_id ||
      !!extra.transfer_group_id ||
      !!extra.natureza;
    if (!associado) {
      semAssociacao.push({
        transaction: t,
        motivo: "Sem vínculo com compra, receita, fatura, transferência ou tarifa.",
      });
    }
    if (t.purchase_id && !categoriaPorCompra.get(t.purchase_id)) {
      semCategoria.push({
        transaction: t,
        motivo: "Saldo confere, mas a compra ainda não tem categoria definida.",
      });
    }
    const pareceCartao = t.tipo === "PAGAMENTO_CARTAO" || /CARTAO|CARTÃO/i.test(t.descricao ?? "");
    if (pareceCartao && (!t.card_invoice_id || !invoiceIds.has(t.card_invoice_id))) {
      pagamentosCartaoSemFatura.push(t);
    }
  }

  // ---------- transferências internas prováveis ----------
  const nomePorConta = new Map((input.accounts ?? []).map((a) => [a.id, a.nome_conta]));
  const outras = input.transactions.filter(
    (t) =>
      t.bank_account_id &&
      t.bank_account_id !== input.accountId &&
      t.status !== "CANCELADA" &&
      !(t as { transfer_group_id?: string | null }).transfer_group_id,
  );
  const transferenciasProvaveis: TransferHint[] = [];
  for (const saida of daConta) {
    if (movementEffect(saida) >= 0) continue;
    if ((saida as { transfer_group_id?: string | null }).transfer_group_id) continue;
    const par = outras.find(
      (t) =>
        t.data_movimento === saida.data_movimento &&
        movementEffect(t) > 0 &&
        Math.abs(Math.abs(Number(t.valor)) - Math.abs(Number(saida.valor))) <= CONFERE,
    );
    if (par && par.bank_account_id) {
      transferenciasProvaveis.push({
        saida,
        entrada: par,
        contaDestino: nomePorConta.get(par.bank_account_id) ?? "Outra conta",
      });
    }
  }

  // ---------- saldo de referência manual ----------
  let referenciaManual: BankAudit["referenciaManual"] = null;
  if (input.saldoReferencia) {
    const { saldo, data } = input.saldoReferencia;
    const coberto = !!periodoFim && periodoFim >= data;
    const saldoCalculado = coberto
      ? arredonda(
          daConta
            .filter((t) => t.data_movimento <= data)
            .reduce((acc, t) => acc + movementEffect(t), 0),
        )
      : null;
    referenciaManual = {
      saldoInformado: saldo,
      data,
      saldoCalculado,
      diferenca: saldoCalculado === null ? null : arredonda(saldo - saldoCalculado),
      coberto,
      diasFaltando: coberto || !periodoFim ? 0 : Math.max(diffDays(periodoFim, data), 0),
    };
  }

  // ---------- problemas encontrados ----------
  const problemas: AuditIssue[] = [];
  for (const m of meses) {
    if (m.status === "VALIDADO" || m.status === "SEM_EXTRATO") continue;
    if (m.status === "INVALID_MATCHES") {
      const ex = m.associacoesInvalidas[0]!;
      problemas.push({
        id: `inval-${m.key}`,
        severity: "CRITICO",
        categoria: "FINANCEIRA",
        titulo: `${m.key} — ${m.associacoesInvalidas.length} associação(ões) automática(s) com movimentação de outro mês`,
        detalhe: `Ex.: "${ex.descricao}" (${ex.dataExtrato}) foi associada a uma movimentação de ${ex.dataLedger}, ${Math.abs(ex.diasDeDiferenca ?? 0)} dias de distância. Reprocesse o mês para desfazer o vínculo e lançar o movimento na data correta.`,
        referencia: m.key,
      });
      continue;
    }
    if (m.status === "SOURCE_FILE_MISSING" || m.status === "CHECKPOINTS_AUSENTES") {
      problemas.push({
        id: `chk-${m.key}`,
        severity: "PENDENCIA",
        categoria: "FINANCEIRA",
        titulo: `${m.key} — sem saldos diários para conferir`,
        detalhe:
          "O extrato deste mês foi importado sem os \"Saldo do dia\". Reenvie o PDF em \"Reprocessar checkpoints\" para gerar a conferência diária.",
        referencia: m.key,
      });
      continue;
    }
    if (m.status === "MOVIMENTOS_INCOMPLETOS") {
      problemas.push({
        id: `mov-${m.key}`,
        severity: "CRITICO",
        categoria: "FINANCEIRA",
        titulo: `${m.key} — ${m.faltantes.length} movimentação(ões) do PDF não existem no ledger`,
        detalhe: m.faltantes
          .slice(0, 5)
          .map((f) => `${f.data ?? "sem data"} · ${f.descricao} · ${f.valor}`)
          .join(" | "),
        referencia: m.key,
      });
      continue;
    }
    if (m.status === "DIVERGENCIA_DIARIA" && m.primeiraDivergencia) {
      problemas.push({
        id: `dia-${m.key}`,
        severity: "CRITICO",
        categoria: "FINANCEIRA",
        titulo: `Primeira divergência encontrada em ${m.primeiraDivergencia.date}`,
        detalhe: `Calculado ${m.primeiraDivergencia.calculado} × banco ${m.primeiraDivergencia.informado} (diferença ${m.primeiraDivergencia.diferenca}). Último dia correto: ${m.primeiraDivergencia.ultimoDiaCorreto ?? "nenhum antes deste"}.`,
        referencia: m.key,
      });
      continue;
    }
    if (m.status === "DIVERGENCIA_FINAL") {
      problemas.push({
        id: `mes-${m.key}`,
        severity: "CRITICO",
        categoria: "FINANCEIRA",
        titulo: `${m.key} — fechamento do mês não bate`,
        detalhe: `Diferença de ${m.difference} entre o saldo informado pelo banco e o calculado.${
          m.checkpoints === 0
            ? " Sem \"Saldo do dia\" importado: reprocesse o PDF para descobrir o dia exato."
            : ""
        }${
          m.datasInconsistentes.length
            ? ` ${m.datasInconsistentes.length} movimentação(ões) deste extrato estão gravadas em outra data no ledger — causa provável.`
            : ""
        }${
          m.diferencaMovimentos !== 0
            ? ` O PDF traz ${m.movimentosPdf} lançamentos e o ledger contabiliza ${m.movimentosLedger} neste mês.`
            : ""
        }`,
        referencia: m.key,
      });
      continue;
    }
    if (m.status === "DATAS_INCONSISTENTES") {
      const primeira = m.datasInconsistentes[0]!;
      problemas.push({
        id: `data-${m.key}`,
        severity: "ATENCAO",
        categoria: "DADOS",
        titulo: `${m.key} — ${m.datasInconsistentes.length} movimentação(ões) com data divergente do extrato`,
        detalhe: `Ex.: "${primeira.descricao}" está em ${primeira.dataLedger} no ledger, mas o extrato informa ${primeira.dataExtrato}.`,
        referencia: m.key,
      });
    }
  }

  for (const c of continuidade) {
    if (!c.confere) {
      problemas.push({
        id: `cont-${c.anterior.id}`,
        severity: "ATENCAO",
        categoria: "FINANCEIRA",
        titulo: "Quebra de continuidade entre extratos",
        detalhe: `O extrato anterior fecha em um valor diferente do que o seguinte abre. Diferença de ${c.diferenca}.`,
      });
    }
    if (c.lacuna) {
      problemas.push({
        id: `gap-${c.anterior.id}`,
        severity: c.confere ? "INFORMATIVO" : "ATENCAO",
        categoria: "FINANCEIRA",
        titulo: `Período sem extrato: ${c.lacuna.inicio} a ${c.lacuna.fim}`,
        detalhe: c.confere
          ? "Continuidade financeira preservada, mas sem detalhamento."
          : "Faltam movimentações neste intervalo.",
      });
    }
    if (c.sobreposicao) {
      problemas.push({
        id: `over-${c.anterior.id}`,
        severity: "ATENCAO",
        categoria: "FINANCEIRA",
        titulo: "Períodos sobrepostos entre extratos",
        detalhe: "Dois extratos cobrem o mesmo intervalo — risco de contagem em dobro.",
      });
    }
  }
  for (const d of duplicidades) {
    problemas.push({
      id: `dup-${d.key}`,
      severity: "ATENCAO",
      categoria: "FINANCEIRA",
      titulo: `Possível duplicidade em ${d.date}`,
      detalhe: `${d.descricao} — ${d.ids.length} lançamentos idênticos.`,
    });
  }
  for (const t of pagamentosCartaoSemFatura) {
    const mismatch = datasInconsistentes.find((m) => m.transactionId === t.id);
    problemas.push({
      id: `cartao-${t.id}`,
      severity: mismatch ? "ATENCAO" : "PENDENCIA",
      categoria: "DADOS",
      titulo: mismatch
        ? "Pagamento de cartão com data divergente do extrato"
        : "Pagamento de cartão sem fatura associada",
      detalhe: mismatch
        ? `Extrato informa ${mismatch.dataExtrato}, ledger gravou ${mismatch.dataLedger}. Valor ${mismatch.valor}.`
        : `${t.data_movimento} · ${t.descricao}`,
    });
  }
  if (semAssociacao.length) {
    problemas.push({
      id: "assoc",
      severity: "PENDENCIA",
      categoria: "DADOS",
      titulo: `${semAssociacao.length} movimentações sem associação`,
      detalhe: "O saldo fecha, mas essas movimentações ainda não têm origem definida.",
    });
  }
  if (semCategoria.length) {
    problemas.push({
      id: "categoria",
      severity: "INFORMATIVO",
      categoria: "DADOS",
      titulo: `${semCategoria.length} movimentações sem categoria`,
      detalhe: "Financeiramente corretas, apenas sem classificação de gasto.",
    });
  }

  const lacunas = continuidade.filter((c) => c.lacuna).length;
  const sobreposicoes = continuidade.filter((c) => c.sobreposicao).length;

  return {
    periodoInicio,
    periodoFim,
    extratos,
    continuidade,
    meses,
    duplicidades,
    semAssociacao,
    semCategoria,
    pagamentosCartaoSemFatura,
    transferenciasProvaveis,
    datasInconsistentes,
    referenciaManual,
    resumo: {
      extratos: extratos.length,
      mesesComContinuidade: continuidade.filter((c) => c.confere).length,
      totalTransicoes: continuidade.length,
      mesesValidados: meses.filter((m) => m.status === "VALIDADO").length,
      totalMeses: meses.length,
      mesesComDivergencia: meses.filter(
        (m) => m.status === "DIVERGENCIA_DIARIA" || m.status === "DIVERGENCIA_FINAL",
      ).length,
      mesesSemCheckpoint: meses.filter((m) => m.checkpoints === 0).length,
      diasComDivergencia: meses.reduce(
        (acc, m) => acc + m.days.filter((d) => d.confere === false).length,
        0,
      ),
      checkpoints: input.checkpoints.length,
      movimentosPdf: meses.reduce((acc, m) => acc + m.movimentosPdf, 0),
      movimentosLedger: meses.reduce((acc, m) => acc + m.movimentosLedger, 0),
      faltantes: meses.reduce((acc, m) => acc + m.faltantes.length, 0),
      datasInconsistentes: datasInconsistentes.length,
      associacoesInvalidas: datasInconsistentes.filter((d) => d.invalido).length,
      semAssociacao: semAssociacao.length,
      semCategoria: semCategoria.length,
      lacunas,
      sobreposicoes,
      duplicidades: duplicidades.length,
    },
    problemas,
  };
}

/** Exporta o relatório em CSV (somente leitura, nada é alterado). */
export function auditToCsv(audit: BankAudit) {
  const linhas: string[][] = [["Seção", "Referência", "Descrição", "Valor", "Status"]];
  for (const c of audit.continuidade) {
    linhas.push([
      "Continuidade",
      `${c.anterior.fim} → ${c.proximo.inicio}`,
      `Fecha ${c.saldoFinalAnterior} / abre ${c.saldoInicialProximo}`,
      String(c.diferenca ?? ""),
      c.confere ? "Confere" : "Quebra de continuidade",
    ]);
  }
  for (const m of audit.meses) {
    linhas.push([
      "Mês",
      m.key,
      `Inicial ${m.openingBalance ?? ""} · Entradas ${m.inflows} · Saídas ${m.outflows} · PDF ${m.movimentosPdf} · Ledger ${m.movimentosLedger} · Checkpoints ${m.checkpoints}`,
      String(m.difference ?? ""),
      MONTH_STATUS_LABELS[m.status],
    ]);
    if (m.primeiraDivergencia) {
      linhas.push([
        "Primeira divergência",
        m.primeiraDivergencia.date,
        `Calculado ${m.primeiraDivergencia.calculado} · Banco ${m.primeiraDivergencia.informado} · Último dia correto ${m.primeiraDivergencia.ultimoDiaCorreto ?? "—"}`,
        String(m.primeiraDivergencia.diferenca),
        "Divergência",
      ]);
    }
    for (const f of m.faltantes) {
      linhas.push([
        "Movimento faltante",
        f.data ?? m.key,
        `${f.descricao} — ${f.motivo}`,
        String(f.valor),
        "Ausente no ledger",
      ]);
    }
    for (const d of m.datasInconsistentes) {
      linhas.push([
        "Data inconsistente",
        d.dataExtrato ?? m.key,
        `${d.descricao} — ledger ${d.dataLedger}${d.dataNoHistorico ? ` · histórico ${d.dataNoHistorico}` : ""}`,
        String(d.valor),
        d.invalido ? "Associação inválida (fora da tolerância)" : "Data divergente",
      ]);
    }
    for (const d of m.days) {
      linhas.push([
        "Dia",
        d.date,
        `Entradas ${d.inflows} · Saídas ${d.outflows} · Calculado ${d.calculated}`,
        String(d.difference ?? ""),
        d.confere === null ? "Sem checkpoint" : d.confere ? "Confere" : "Divergência",
      ]);
    }
  }
  for (const p of audit.problemas) {
    linhas.push([
      `Problema · ${ISSUE_CATEGORY_LABELS[p.categoria]}`,
      p.referencia ?? "",
      `${p.titulo} — ${p.detalhe}`,
      "",
      p.severity,
    ]);
  }
  return linhas
    .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
}
