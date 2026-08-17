/**
 * OBJETO CANÔNICO DO EXTRATO — única fonte de verdade entre PDF e ledger.
 *
 * Pipeline obrigatório:
 *   PDF → PARSER → ParsedStatement (canônico) → VALIDATOR → RECONCILIATION → LEDGER → AUDIT
 *
 * Regras absolutas desta camada:
 *  - nenhuma camada posterior pode reinterpretar o PDF;
 *  - `postingDate` é extraído UMA vez pelo parser e é imutável daqui em diante;
 *  - datas escritas dentro do histórico viram `occurredAt`, nunca `postingDate`;
 *  - `periodStart`/`periodEnd` vêm do período oficial do documento — nunca de
 *    saldo anterior, saldo final, primeira/última movimentação ou checkpoint;
 *  - "quantos movimentos o PDF tem" é resposta EXCLUSIVA deste objeto: a
 *    deduplicação acontece depois e nunca altera esta contagem.
 */
import type { ParsedBankStatement, ParsedBankMovement } from "./types";

/** Versão do parser que produziu o objeto (bb-v1, itau-v1, ...). */
export type ParserVersion = string;

export type CanonicalDirection = "IN" | "OUT";

export type CanonicalTransaction = {
  /** Identidade determinística da linha do PDF. */
  sourceId: string;
  /** Data contábil (coluna "Dia"). Imutável após o parser. */
  postingDate: string | null;
  /** Data citada no histórico. Metadata — nunca substitui postingDate. */
  occurredAt: string | null;
  description: string;
  normalizedDescription: string;
  /** Valor absoluto; o sentido fica em `direction`. */
  amount: number;
  direction: CanonicalDirection;
  /** Valor com sinal, como lido do documento (entrada +, saída −). */
  signedAmount: number;
  sourcePage: number | null;
  sourceRow: number;
  rawText: string;
  kind: ParsedBankMovement["tipo"];
  /** Operação bancária impressa pelo documento, quando identificada. */
  bankOperation?: string | null;
  /** Contraparte do lançamento, quando identificada. */
  counterparty?: string | null;
  /** Colunas técnicas do extrato — metadata, nunca descrição. */
  lot?: string | null;
  documentNumber?: string | null;
};

export type CanonicalCheckpoint = {
  date: string;
  amount: number;
  type: "OPENING" | "DAILY" | "CLOSING" | "REFERENCE";
  label?: string | null;
};

export type CanonicalStatement = {
  parserVersion: ParserVersion;
  parser: string;
  bank: string | null;
  account: string | null;
  accountId: string | null;
  statementId: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: { date: string | null; amount: number | null };
  closingBalance: { date: string | null; amount: number | null };
  transactions: CanonicalTransaction[];
  checkpoints: CanonicalCheckpoint[];
  /** Lançamentos futuros: informativos, nunca entram no período realizado. */
  futureTransactions: CanonicalTransaction[];
  /** Saldo informado fora do período (referência do documento). */
  referenceBalance: { date: string; amount: number } | null;
};

/** Hash determinístico e estável (FNV-1a, 32 bits) — sem dependências. */
function fnv1a(texto: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < texto.length; i++) {
    h ^= texto.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

function normalizarRaw(raw: string) {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * sourceId determinístico: banco + conta + statement + posting date + valor +
 * sentido + linha bruta normalizada + índice da linha. Permite rastrear
 * PDF → parsed item → reconciliation → transaction.
 */
export function buildSourceId(input: {
  bank: string | null;
  account: string | null;
  statementId: string;
  postingDate: string | null;
  amount: number;
  direction: CanonicalDirection;
  rawText: string;
  sourceRow: number;
}): string {
  const chave = [
    normalizarRaw(input.bank ?? ""),
    normalizarRaw(input.account ?? ""),
    input.statementId,
    input.postingDate ?? "SEM_DATA",
    input.amount.toFixed(2),
    input.direction,
    normalizarRaw(input.rawText),
    String(input.sourceRow),
  ].join("|");
  return `${fnv1a(chave)}-${fnv1a(chave.split("").reverse().join(""))}`;
}

export type CanonicalContext = {
  /** Identificador estável do documento (nome do arquivo, id do import...). */
  statementId: string;
  bank?: string | null;
  account?: string | null;
  accountId?: string | null;
  parserVersion?: ParserVersion;
};

function toTransactions(
  movimentos: ParsedBankMovement[],
  raws: ParsedBankStatement["aceitos"],
  ctx: { bank: string | null; account: string | null; statementId: string },
  offset = 0,
): CanonicalTransaction[] {
  return movimentos.map((m, i) => {
    const bruto = raws[i];
    const rawText = bruto?.raw ?? m.descricaoOriginal;
    const direction: CanonicalDirection = m.valor >= 0 ? "IN" : "OUT";
    const amount = Math.abs(m.valor);
    const sourceRow = offset + i;
    return {
      sourceId: buildSourceId({
        bank: ctx.bank,
        account: ctx.account,
        statementId: ctx.statementId,
        postingDate: m.data,
        amount,
        direction,
        rawText,
        sourceRow,
      }),
      postingDate: m.data,
      occurredAt: m.eventDate ?? null,
      description: m.descricaoOriginal,
      normalizedDescription: m.descricaoNormalizada,
      amount,
      direction,
      signedAmount: m.valor,
      sourcePage: bruto?.page ?? null,
      sourceRow,
      rawText,
      kind: m.tipo,
      bankOperation: m.bankOperation ?? null,
      counterparty: m.counterparty ?? null,
      lot: m.lot ?? null,
      documentNumber: m.documentNumber ?? null,
    };
  });
}

/**
 * Converte a saída do parser no objeto canônico. É uma conversão 1:1: nada é
 * reinterpretado, recalculado ou inferido aqui.
 */
export function toCanonicalStatement(
  parsed: ParsedBankStatement,
  ctx: CanonicalContext,
): CanonicalStatement {
  const bank = ctx.bank ?? parsed.identificacao?.banco ?? null;
  const account = ctx.account ?? parsed.identificacao?.conta ?? null;
  const base = { bank, account, statementId: ctx.statementId };

  const checkpoints: CanonicalCheckpoint[] = (parsed.checkpoints ?? []).map((c) => ({
    date: c.data,
    amount: c.saldo,
    type: c.tipo === "CLOSING" ? ("CLOSING" as const) : ("DAILY" as const),
    label: c.rotulo ?? null,
  }));

  return {
    parserVersion: ctx.parserVersion ?? parserVersionOf(parsed.parser),
    parser: parsed.parser,
    bank,
    account,
    accountId: ctx.accountId ?? null,
    statementId: ctx.statementId,
    periodStart: parsed.periodoInicio,
    periodEnd: parsed.periodoFim,
    // Saldo anterior é METADATA fora do período: sua data nunca vira periodStart.
    openingBalance: { date: parsed.saldoInicialData ?? null, amount: parsed.saldoInicial },
    closingBalance: {
      date: parsed.saldoFinalData ?? parsed.periodoFim,
      amount: parsed.saldoFinal,
    },
    transactions: toTransactions(parsed.movimentos, parsed.aceitos ?? [], base),
    futureTransactions: toTransactions(
      parsed.futuros ?? [],
      [],
      base,
      parsed.movimentos.length,
    ),
    checkpoints,
    referenceBalance: parsed.saldoReferenciaAtual
      ? { date: parsed.saldoReferenciaAtual.data, amount: parsed.saldoReferenciaAtual.saldo }
      : null,
  };
}

/** Versão declarada de cada parser conhecido. */
export const PARSER_VERSIONS: Record<string, ParserVersion> = {
  EXTRATO_BANCO_DO_BRASIL_PDF: "bb-v1",
  ITAU_BANK_STATEMENT: "itau-v1",
  EXTRATO_GENERICO_PDF: "generic-v1",
};

export function parserVersionOf(parser: string): ParserVersion {
  return PARSER_VERSIONS[parser] ?? `${parser.toLowerCase()}-v1`;
}

/** Mês de referência do extrato — sempre derivado do PERÍODO OFICIAL. */
export function statementMonthKey(statement: CanonicalStatement): string | null {
  const fim = statement.periodEnd;
  return fim ? fim.slice(0, 7) : null;
}

export function statementTotals(statement: CanonicalStatement) {
  const inflows = statement.transactions
    .filter((t) => t.direction === "IN")
    .reduce((a, t) => a + t.amount, 0);
  const outflows = statement.transactions
    .filter((t) => t.direction === "OUT")
    .reduce((a, t) => a + t.amount, 0);
  return {
    inflows: Number(inflows.toFixed(2)),
    outflows: Number(outflows.toFixed(2)),
    count: statement.transactions.length,
  };
}

/**
 * SNAPSHOT CANÔNICO PERSISTIDO DO EXTRATO.
 *
 * Fotografia mínima e suficiente do ParsedBankStatement validado, gravada junto
 * da importação (`dados_brutos_json`). É a FONTE DE VERDADE da auditoria sobre
 * "o que o PDF dizia" — sem ela, checkpoints, data do saldo anterior e
 * identidade das linhas se perdem e a auditoria passa a chutar por heurística.
 *
 * Não guarda o PDF binário: guarda a estrutura econômica declarada.
 */
export type StatementSnapshotTransaction = {
  sourceId: string;
  occurrenceIndex: number;
  postingDate: string | null;
  amount: number;
  direction: CanonicalDirection;
  description: string;
  documentNumber: string | null;
  lot: string | null;
};

export type StatementSnapshot = {
  snapshotVersion: 1;
  parserVersion: ParserVersion;
  parser: string;
  bank: string | null;
  accountIdentifier: string | null;
  periodStart: string | null;
  periodEnd: string | null;
  openingBalance: { date: string | null; amount: number | null };
  closingBalance: { date: string | null; amount: number | null };
  referenceBalance: { date: string; amount: number } | null;
  transactionsMetadata: StatementSnapshotTransaction[];
  checkpoints: CanonicalCheckpoint[];
};

/** Constrói o snapshot canônico a partir do statement canônico. */
export function buildStatementSnapshot(statement: CanonicalStatement): StatementSnapshot {
  const contagem = new Map<string, number>();
  const transactionsMetadata = statement.transactions.map((t) => {
    const base = [t.postingDate ?? "", t.amount.toFixed(2), t.direction, t.normalizedDescription]
      .join("|");
    const occurrenceIndex = contagem.get(base) ?? 0;
    contagem.set(base, occurrenceIndex + 1);
    return {
      sourceId: t.sourceId,
      occurrenceIndex,
      postingDate: t.postingDate,
      amount: t.amount,
      direction: t.direction,
      description: t.description,
      documentNumber: t.documentNumber ?? null,
      lot: t.lot ?? null,
    };
  });

  return {
    snapshotVersion: 1,
    parserVersion: statement.parserVersion,
    parser: statement.parser,
    bank: statement.bank,
    accountIdentifier: statement.account,
    periodStart: statement.periodStart,
    periodEnd: statement.periodEnd,
    openingBalance: statement.openingBalance,
    closingBalance: statement.closingBalance,
    referenceBalance: statement.referenceBalance,
    transactionsMetadata,
    checkpoints: statement.checkpoints,
  };
}

/** Lê um snapshot persistido com segurança (importações antigas não têm). */
export function readStatementSnapshot(raw: unknown): StatementSnapshot | null {
  if (!raw || typeof raw !== "object") return null;
  const s = raw as Partial<StatementSnapshot>;
  if (!Array.isArray(s.checkpoints) && !Array.isArray(s.transactionsMetadata)) return null;
  return {
    snapshotVersion: 1,
    parserVersion: s.parserVersion ?? "desconhecido",
    parser: s.parser ?? "desconhecido",
    bank: s.bank ?? null,
    accountIdentifier: s.accountIdentifier ?? null,
    periodStart: s.periodStart ?? null,
    periodEnd: s.periodEnd ?? null,
    openingBalance: s.openingBalance ?? { date: null, amount: null },
    closingBalance: s.closingBalance ?? { date: null, amount: null },
    referenceBalance: s.referenceBalance ?? null,
    transactionsMetadata: Array.isArray(s.transactionsMetadata) ? s.transactionsMetadata : [],
    checkpoints: Array.isArray(s.checkpoints) ? s.checkpoints : [],
  };
}
