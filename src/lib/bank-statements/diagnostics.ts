/**
 * DIAGNÓSTICO DO PARSER BANCÁRIO (somente leitura).
 *
 * Roda o pipeline inteiro em memória e devolve CADA ETAPA separada:
 *
 *   PDF → raw items (pdf.js) → detecção do banco → montagem de linhas →
 *   parser → ParsedBankStatement → canônico → validação
 *
 * Regras desta camada:
 *  - nada é persistido: não cria import, item, transação, ledger ou conciliação;
 *  - nada é corrigido automaticamente: divergência aparece como divergência;
 *  - nenhuma linha é escondida: o que o parser descartou aparece em "ignorados"
 *    com motivo e tratamento.
 */
import { extractPdfPageLayouts, layoutPageLines, type PdfLine } from "@/lib/pdf-extract";
import {
  isBancoDoBrasil,
  parseBancoDoBrasilLines,
} from "@/lib/bank-statement-parsers/banco-do-brasil";
import {
  detectItauBankStatement,
  parseItauBankStatementLayouts,
  type ItauDetection,
  type ItauPipelineDiagnostics,
} from "@/lib/bank-statement-parsers/itau";
import { parseBankStatementLines } from "./parse";
import { toCanonicalStatement, type CanonicalStatement } from "./canonical";
import { validateStatement, type StatementValidation } from "./validate";
import { goldenFor, type GoldenStatement } from "./golden";
import type { ParsedBankStatement } from "./types";

// ------------------------------------------------------------------- tipos

export type DiagRawItem = {
  page: number;
  index: number;
  text: string;
  x: number;
  y: number;
  width: number;
  /** pdf.js não expõe altura por item neste extrator. */
  height: number | null;
};

export type DiagRowStatus =
  | "PARSED_TRANSACTION"
  | "PARSED_CHECKPOINT"
  | "IGNORED"
  | "ERROR";

export type DiagRow = {
  index: number;
  page: number;
  y: number;
  date: string | null;
  description: string;
  amount: number | null;
  balance: number | null;
  raw: string;
  rawItemIndexes: number[];
  status: DiagRowStatus;
  reason: string;
  /** Preenchido quando a linha virou transação canônica. */
  sourceId: string | null;
};

export type DiagIgnored = {
  raw: string;
  valor: number | null;
  page: number | null;
  /** Código estável do motivo (para leitura externa). */
  reason: string;
  /** Descrição em texto do que o parser fez com a linha. */
  treatment: string;
};

export type DiagFailureStage =
  | "PDF_TEXT_EXTRACTION"
  | "BANK_DETECTION"
  | "ROW_ASSEMBLY"
  | "ROW_TO_TRANSACTION"
  | "PERIOD_FILTER"
  | null;

export type DiagDetection = {
  detectedBank: string;
  score: number;
  matchedSignals: string[];
  parser: string;
  parserVersion: string;
};

export type DiagGolden = {
  monthKey: string;
  expected: GoldenStatement;
  found: { transactions: number; opening: number | null; closing: number | null };
  difference: number;
  /** Linhas que deveriam ter virado transação e não viraram. */
  missingRows: DiagRow[];
};

export type BankParserDiagnostics = {
  file: string;
  readAt: string;
  detection: DiagDetection;
  statement: CanonicalStatement;
  validation: StatementValidation;
  rawItems: DiagRawItem[];
  rows: DiagRow[];
  ignored: DiagIgnored[];
  counts: {
    rawItems: number;
    rows: number;
    transactions: number;
    checkpoints: number;
    ignored: number;
  };
  columns: ItauPipelineDiagnostics["columns"] | null;
  failure: { stage: DiagFailureStage; reason: string | null };
  golden: DiagGolden | null;
  /** Erro fatal de leitura (PDF ilegível/protegido). */
  error: string | null;
};

// ------------------------------------------------------------------ helpers

const normalizar = (s: string) => s.replace(/\s+/g, " ").trim().toUpperCase();

/** Traduz o motivo textual do parser em código + tratamento estáveis. */
export function classificarIgnorado(reason: string): { code: string; treatment: string } {
  const t = reason.toLowerCase();
  if (t.includes("balance_checkpoint") || t.includes("saldo do dia"))
    return { code: "BALANCE_CHECKPOINT", treatment: "CHECKPOINT_DE_SALDO" };
  if (t.includes("fora do período") || t.includes("fora do periodo"))
    return { code: "OUTSIDE_STATEMENT_PERIOD", treatment: "REFERENCE_BALANCE" };
  if (t.includes("somente coluna de saldo"))
    return { code: "BALANCE_ONLY_ROW", treatment: "NAO_E_MOVIMENTACAO" };
  if (t.includes("sem valor")) return { code: "AMOUNT_NOT_FOUND", treatment: "DESCARTADA" };
  if (t.includes("sem data")) return { code: "POSTING_DATE_NOT_FOUND", treatment: "DESCARTADA" };
  if (t.includes("sem descrição") || t.includes("sem descricao"))
    return { code: "DESCRIPTION_NOT_FOUND", treatment: "DESCARTADA" };
  if (t.includes("institucional") || t.includes("cabeçalho") || t.includes("cabecalho"))
    return { code: "DOCUMENT_METADATA", treatment: "IGNORADA" };
  if (t.includes("valor zerado")) return { code: "ZERO_AMOUNT", treatment: "DESCARTADA" };
  return { code: "OTHER", treatment: reason };
}

/** Índices dos itens crus que produziram a linha (mesma página, mesmo Y). */
function itensDaLinha(rawItems: DiagRawItem[], page: number, y: number, tolerancia = 3) {
  return rawItems
    .filter((i) => i.page === page && Math.abs(i.y - y) <= tolerancia)
    .map((i) => i.index);
}

type LinhaBruta = {
  page: number;
  y: number;
  raw: string;
  date: string | null;
  description: string;
  amount: number | null;
  balance: number | null;
};

/** Rows do parser Itaú (geometria) ou linhas reconstruídas dos demais layouts. */
function linhasDoParser(
  parsed: ParsedBankStatement,
  lines: PdfLine[],
): LinhaBruta[] {
  const pipeline = (parsed as { pipeline?: ItauPipelineDiagnostics }).pipeline;
  if (pipeline?.rows?.length)
    return pipeline.rows.map((r) => ({
      page: r.page,
      y: r.y,
      raw: r.raw,
      date: r.date,
      description: r.description,
      amount: r.amount,
      balance: r.balance,
    }));
  return lines
    .map((l) => ({
      page: l.page ?? 1,
      y: l.y,
      raw: l.text.replace(/\s+/g, " ").trim(),
      date: null,
      description: l.text.replace(/\s+/g, " ").trim(),
      amount: null,
      balance: null,
    }))
    .filter((l) => l.raw);
}

/**
 * Reconstrói o destino de cada linha: transação, checkpoint, ignorada ou erro.
 * O casamento é feito pelo texto bruto que o próprio parser registrou em
 * `aceitos` / `rejeitados`, na ordem em que ele processou.
 */
function anotarRows(
  linhas: LinhaBruta[],
  parsed: ParsedBankStatement,
  statement: CanonicalStatement,
  rawItems: DiagRawItem[],
): DiagRow[] {
  const aceitosPorRaw = new Map<string, number[]>();
  parsed.aceitos.forEach((a, i) => {
    const chave = normalizar(a.raw);
    aceitosPorRaw.set(chave, [...(aceitosPorRaw.get(chave) ?? []), i]);
  });
  const rejeitadosPorRaw = new Map<string, string[]>();
  parsed.rejeitados.forEach((r) => {
    const chave = normalizar(r.raw);
    rejeitadosPorRaw.set(chave, [...(rejeitadosPorRaw.get(chave) ?? []), r.reason]);
  });

  const transacoesPorRaw = new Map<string, string[]>();
  statement.transactions.forEach((t) => {
    const chave = normalizar(t.rawText);
    transacoesPorRaw.set(chave, [...(transacoesPorRaw.get(chave) ?? []), t.sourceId]);
  });

  return linhas.map((l, index) => {
    const chave = normalizar(l.raw);
    const base = {
      index,
      page: l.page,
      y: l.y,
      date: l.date,
      description: l.description,
      amount: l.amount,
      balance: l.balance,
      raw: l.raw,
      rawItemIndexes: itensDaLinha(rawItems, l.page, l.y),
    };

    const sourceIds = transacoesPorRaw.get(chave);
    if (sourceIds?.length) {
      const sourceId = sourceIds.shift() as string;
      return { ...base, status: "PARSED_TRANSACTION" as const, reason: "OK", sourceId };
    }

    const motivos = rejeitadosPorRaw.get(chave);
    if (motivos?.length) {
      const motivo = motivos.shift() as string;
      const { code } = classificarIgnorado(motivo);
      const status: DiagRowStatus =
        code === "BALANCE_CHECKPOINT"
          ? "PARSED_CHECKPOINT"
          : code === "AMOUNT_NOT_FOUND" || code === "POSTING_DATE_NOT_FOUND"
            ? "ERROR"
            : "IGNORED";
      return { ...base, status, reason: code, sourceId: null };
    }

    // Linha aceita pelo parser mas que não sobreviveu ao filtro de período.
    if (aceitosPorRaw.get(chave)?.length)
      return {
        ...base,
        status: "IGNORED" as const,
        reason: "OUTSIDE_STATEMENT_PERIOD",
        sourceId: null,
      };

    return { ...base, status: "IGNORED" as const, reason: "DOCUMENT_METADATA", sourceId: null };
  });
}

/** Onde exatamente o pipeline zerou — nunca só "0 movimentações". */
function detectarFalha(input: {
  rawItems: number;
  rows: number;
  transactions: number;
  detectedBank: string;
  rowsAceitas: number;
  periodo: boolean;
}): { stage: DiagFailureStage; reason: string | null } {
  if (input.rawItems === 0)
    return {
      stage: "PDF_TEXT_EXTRACTION",
      reason: "O PDF não devolveu texto (documento digitalizado ou protegido).",
    };
  if (input.rows === 0)
    return { stage: "ROW_ASSEMBLY", reason: "Nenhuma linha foi montada a partir dos itens." };
  if (input.transactions > 0) return { stage: null, reason: null };
  if (input.detectedBank === "UNKNOWN" || input.detectedBank === "GENERICO")
    return {
      stage: "BANK_DETECTION",
      reason: "Nenhum parser específico reconheceu o layout deste documento.",
    };
  if (input.rowsAceitas > 0 && input.periodo)
    return {
      stage: "PERIOD_FILTER",
      reason: "As linhas foram lidas, mas todas ficaram fora do período do documento.",
    };
  return {
    stage: "ROW_TO_TRANSACTION",
    reason: "As linhas foram montadas, mas a coluna de valor não foi reconhecida.",
  };
}

// -------------------------------------------------------------------- motor

/** Executa o pipeline completo em memória. Nunca grava nada. */
export async function buildBankParserDiagnostics(
  file: Blob,
  fileName: string,
): Promise<BankParserDiagnostics> {
  const vazio = (error: string): BankParserDiagnostics => ({
    file: fileName,
    readAt: new Date().toISOString(),
    detection: {
      detectedBank: "UNKNOWN",
      score: 0,
      matchedSignals: [],
      parser: "—",
      parserVersion: "—",
    },
    statement: {} as CanonicalStatement,
    validation: { status: "PARSED_STATEMENT_INVALID", problems: [error], math: {
      opening: null, inflows: 0, outflows: 0, calculatedClosing: null,
      declaredClosing: null, difference: null, ok: false,
    }, checkpoints: [] },
    rawItems: [],
    rows: [],
    ignored: [],
    counts: { rawItems: 0, rows: 0, transactions: 0, checkpoints: 0, ignored: 0 },
    columns: null,
    failure: { stage: "PDF_TEXT_EXTRACTION", reason: error },
    golden: null,
    error,
  });

  let pages;
  try {
    pages = await extractPdfPageLayouts(file);
  } catch (e) {
    return vazio(e instanceof Error ? e.message : "Falha ao abrir o PDF.");
  }

  let contador = 0;
  const rawItems: DiagRawItem[] = pages.flatMap((p) =>
    p.items
      .filter((i) => i.text.trim())
      .map((i) => ({
        page: p.page,
        index: contador++,
        text: i.text,
        x: Number(i.x.toFixed(2)),
        y: Number(i.y.toFixed(2)),
        width: Number(i.width.toFixed(2)),
        height: null,
      })),
  );

  const lines = pages.flatMap((p) => layoutPageLines(p.items, p.width, p.page));
  const textos = lines.map((l) => l.text.replace(/\s+/g, " ").trim()).filter(Boolean);
  const itensTexto = rawItems.map((i) => i.text);

  const itau: ItauDetection = detectItauBankStatement([...textos, ...itensTexto]);
  const ehItau = itau.detectedBank === "ITAU";
  const ehBB = !ehItau && isBancoDoBrasil(textos);

  let parsed: ParsedBankStatement;
  try {
    parsed = ehItau
      ? parseItauBankStatementLayouts(pages)
      : ehBB
        ? parseBancoDoBrasilLines(lines)
        : parseBankStatementLines(lines);
  } catch (e) {
    return vazio(e instanceof Error ? e.message : "Falha no parser.");
  }

  const statement = toCanonicalStatement(parsed, { statementId: fileName });
  const validation = validateStatement(statement);
  const pipeline = (parsed as { pipeline?: ItauPipelineDiagnostics }).pipeline;

  const rows = anotarRows(linhasDoParser(parsed, lines), parsed, statement, rawItems);

  const ignored: DiagIgnored[] = parsed.rejeitados.map((r) => {
    const { code, treatment } = classificarIgnorado(r.reason);
    return {
      raw: r.raw,
      valor: r.valor,
      page: r.page ?? null,
      reason: code,
      treatment: `${treatment} — ${r.reason}`,
    };
  });
  if (parsed.saldoReferenciaAtual)
    ignored.push({
      raw: `SALDO DO DIA ${parsed.saldoReferenciaAtual.data}`,
      valor: parsed.saldoReferenciaAtual.saldo,
      page: null,
      reason: "OUTSIDE_STATEMENT_PERIOD",
      treatment: "REFERENCE_BALANCE — saldo posterior ao período, usado só como referência",
    });

  const detectedBank = ehItau ? "ITAU" : ehBB ? "BANCO_DO_BRASIL" : "GENERICO";
  const detection: DiagDetection = {
    detectedBank,
    score: ehItau ? itau.confidence : ehBB ? 1 : 0,
    matchedSignals: ehItau
      ? itau.matchedSignals
      : ehBB
        ? ["layout Banco do Brasil com sinal impresso (+)/(-)"]
        : [],
    parser: statement.parser,
    parserVersion: statement.parserVersion,
  };

  const monthKey = statement.periodEnd?.slice(0, 7) ?? null;
  const esperado = detectedBank === "BANCO_DO_BRASIL" && monthKey ? goldenFor(monthKey) : undefined;
  const golden: DiagGolden | null = esperado
    ? {
        monthKey: monthKey as string,
        expected: esperado,
        found: {
          transactions: statement.transactions.length,
          opening: statement.openingBalance.amount,
          closing: statement.closingBalance.amount,
        },
        difference: statement.transactions.length - esperado.transactions,
        missingRows: rows.filter((r) => r.status === "ERROR" || r.reason === "AMOUNT_NOT_FOUND"),
      }
    : null;

  return {
    file: fileName,
    readAt: new Date().toISOString(),
    detection,
    statement,
    validation,
    rawItems,
    rows,
    ignored,
    counts: {
      rawItems: rawItems.length,
      rows: rows.length,
      transactions: statement.transactions.length,
      checkpoints: statement.checkpoints.length,
      ignored: ignored.length,
    },
    columns: pipeline?.columns ?? null,
    failure: detectarFalha({
      rawItems: rawItems.length,
      rows: rows.length,
      transactions: statement.transactions.length,
      detectedBank,
      rowsAceitas: parsed.aceitos.length,
      periodo: !!statement.periodStart && !!statement.periodEnd,
    }),
    golden,
    error: null,
  };
}

/** Exportação plana (CSV) das linhas — para análise externa. */
export function diagnosticsToCsv(d: BankParserDiagnostics): string {
  const cabecalho = [
    "arquivo",
    "banco",
    "parser",
    "versao",
    "periodo_inicio",
    "periodo_fim",
    "row_index",
    "page",
    "y",
    "date",
    "description",
    "amount",
    "balance",
    "status",
    "reason",
    "source_id",
    "raw",
  ];
  const escapar = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const linhas = d.rows.map((r) =>
    [
      d.file,
      d.detection.detectedBank,
      d.detection.parser,
      d.detection.parserVersion,
      d.statement?.periodStart ?? "",
      d.statement?.periodEnd ?? "",
      r.index,
      r.page,
      r.y,
      r.date ?? "",
      r.description,
      r.amount ?? "",
      r.balance ?? "",
      r.status,
      r.reason,
      r.sourceId ?? "",
      r.raw,
    ]
      .map(escapar)
      .join(","),
  );
  return [cabecalho.join(","), ...linhas].join("\n");
}

/**
 * Diagnóstico a partir de um extrato JÁ lido (rascunho da revisão), sem o PDF.
 * As etapas de itens crus e montagem de linhas ficam indisponíveis — o que o
 * parser decidiu (transações, checkpoints, ignorados, validação) continua todo
 * visível, e isso é declarado explicitamente na tela.
 */
export function diagnosticsFromParsedStatement(
  parsed: ParsedBankStatement,
  fileName: string,
): BankParserDiagnostics {
  const statement = toCanonicalStatement(parsed, { statementId: fileName });
  const validation = validateStatement(statement);
  const pipeline = (parsed as { pipeline?: ItauPipelineDiagnostics }).pipeline;

  const linhas: LinhaBruta[] = [
    ...parsed.aceitos.map((a) => ({
      page: a.page ?? 1,
      y: 0,
      raw: a.raw,
      date: null,
      description: a.raw,
      amount: a.valor,
      balance: null,
    })),
    ...parsed.rejeitados.map((r) => ({
      page: r.page ?? 1,
      y: 0,
      raw: r.raw,
      date: null,
      description: r.raw,
      amount: r.valor,
      balance: null,
    })),
  ];
  const rows = anotarRows(linhas, parsed, statement, []);

  const ignored: DiagIgnored[] = parsed.rejeitados.map((r) => {
    const { code, treatment } = classificarIgnorado(r.reason);
    return {
      raw: r.raw,
      valor: r.valor,
      page: r.page ?? null,
      reason: code,
      treatment: `${treatment} — ${r.reason}`,
    };
  });

  const detectedBank = pipeline?.detection.detectedBank ?? parsed.identificacao?.banco ?? "—";
  const monthKey = statement.periodEnd?.slice(0, 7) ?? null;
  const esperado = monthKey && parsed.parser.includes("BB") ? goldenFor(monthKey) : undefined;

  return {
    file: fileName,
    readAt: new Date().toISOString(),
    detection: {
      detectedBank,
      score: pipeline?.detection.confidence ?? 0,
      matchedSignals: pipeline?.detection.matchedSignals ?? [],
      parser: statement.parser,
      parserVersion: statement.parserVersion,
    },
    statement,
    validation,
    rawItems: [],
    rows,
    ignored,
    counts: {
      rawItems: pipeline?.rawItems ?? 0,
      rows: rows.length,
      transactions: statement.transactions.length,
      checkpoints: statement.checkpoints.length,
      ignored: ignored.length,
    },
    columns: pipeline?.columns ?? null,
    failure: detectarFalha({
      rawItems: pipeline?.rawItems ?? 1,
      rows: rows.length,
      transactions: statement.transactions.length,
      detectedBank,
      rowsAceitas: parsed.aceitos.length,
      periodo: !!statement.periodStart && !!statement.periodEnd,
    }),
    golden: esperado
      ? {
          monthKey: monthKey as string,
          expected: esperado,
          found: {
            transactions: statement.transactions.length,
            opening: statement.openingBalance.amount,
            closing: statement.closingBalance.amount,
          },
          difference: statement.transactions.length - esperado.transactions,
          missingRows: rows.filter((r) => r.status === "ERROR"),
        }
      : null,
    error: null,
  };
}
