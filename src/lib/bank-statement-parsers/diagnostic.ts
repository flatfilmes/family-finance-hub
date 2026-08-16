/**
 * Dry run do parser de EXTRATO BANCÁRIO para o Modo diagnóstico PDF.
 *
 * Executa EXATAMENTE o mesmo pipeline puro da importação normal:
 *
 *   PDF → pdf.js → rawItems → rows → detectBank() → selectParser() →
 *   parse() → ParsedBankStatement (canônico) → validate() → parserOutput
 *
 * Roda inteiramente em memória: não cria bank_statement_imports, itens,
 * transações, conciliações, compras ou receitas — e nunca altera saldo.
 *
 * Nunca devolve `parser: null` silenciosamente: quando nenhum parser é
 * selecionado o resultado é PARSER_NOT_SELECTED (com os sinais encontrados) e,
 * quando o parser explode, PARSER_EXECUTION_FAILED (com mensagem e etapa).
 */
import { buildBankParserDiagnostics } from "@/lib/bank-statements/diagnostics";
import type { ParserDryRunResult } from "@/lib/pdf-diagnostic/diagnostic-types";

const PARSER_NAMES: Record<string, string> = {
  BANCO_DO_BRASIL: "BANCO_DO_BRASIL_STATEMENT",
  ITAU: "ITAU_BANK_STATEMENT",
  GENERICO: "EXTRATO_GENERICO_PDF",
  UNKNOWN: "EXTRATO_GENERICO_PDF",
};

const ehLinhaDeSaldoDoDia = (texto: string) =>
  texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .includes("saldo do dia");

export const bankStatementDryRun = async (file: Blob): Promise<ParserDryRunResult> => {
  const fileName = (file as File).name ?? "extrato.pdf";
  const d = await buildBankParserDiagnostics(file, fileName);
  const bank = d.detection.detectedBank;
  const parserName = d.detection.parser || PARSER_NAMES[bank] || PARSER_NAMES.GENERICO;

  const counts = {
    rawItems: d.counts.rawItems,
    rows: d.counts.rows,
    transactions: d.counts.transactions,
    checkpoints: d.counts.checkpoints,
  };

  // Erro fatal de leitura ou parser que explodiu.
  if (d.error)
    return {
      parser: parserName,
      bank,
      version: d.detection.parserVersion,
      status: "PARSER_EXECUTION_FAILED",
      error: d.error,
      stage: d.failure.stage,
      signals: d.detection.matchedSignals,
      counts,
      output: { status: "PARSER_EXECUTION_FAILED", error: d.error, stage: d.failure.stage },
      debug: { accepted: [], rejected: [], metadata: [{ campo: "erro", valor: d.error }] },
    };

  // Nenhum parser específico reconheceu o layout.
  const naoSelecionado = bank === "UNKNOWN" || (bank === "GENERICO" && !counts.transactions);

  const statement = d.statement;
  const trace = d.rows
    .filter((r) => ehLinhaDeSaldoDoDia(`${r.raw} ${r.description}`))
    .map((r) => {
      const checkpoint =
        r.balance !== null
          ? statement.checkpoints?.find((c) => Math.abs(c.amount - (r.balance as number)) < 0.005)
          : statement.checkpoints?.find((c) => c.date === r.date);
      return {
        row: r.raw,
        page: r.page,
        status: checkpoint ? "PARSED_CHECKPOINT" : r.status === "ERROR" ? "ERROR" : "IGNORED",
        date: checkpoint?.date ?? r.date,
        balance: checkpoint?.amount ?? r.balance,
        reason: checkpoint ? checkpoint.type : r.reason,
      };
    });

  const parserOutput = {
    status: naoSelecionado ? "PARSER_NOT_SELECTED" : "OK",
    bank,
    parser: parserName,
    version: d.detection.parserVersion,
    periodStart: statement.periodStart ?? null,
    periodEnd: statement.periodEnd ?? null,
    openingBalance: statement.openingBalance ?? null,
    closingBalance: statement.closingBalance ?? null,
    referenceBalance: statement.referenceBalance ?? null,
    transactions: statement.transactions ?? [],
    checkpoints: statement.checkpoints ?? [],
    validation: d.validation,
    counts,
    failure: d.failure,
    checkpointTrace: trace,
  };

  return {
    parser: naoSelecionado ? "PARSER_NOT_SELECTED" : parserName,
    bank,
    version: d.detection.parserVersion,
    status: naoSelecionado ? "PARSER_NOT_SELECTED" : "OK",
    error: null,
    stage: d.failure.stage,
    signals: d.detection.matchedSignals,
    counts,
    checkpointTrace: trace,
    output: parserOutput,
    debug: {
      accepted: (statement.transactions ?? []).map((t) => ({
        raw: t.rawText,
        valor: t.signedAmount,
        page: t.sourcePage,
        detalhe: `${t.postingDate ?? "sem data"} · ${t.kind} · ${t.sourceId}`,
      })),
      rejected: d.ignored.map((i) => ({
        raw: i.raw,
        valor: i.valor,
        page: i.page,
        reason: `${i.reason} — ${i.treatment}`,
      })),
      metadata: [
        { campo: "banco detectado", valor: bank },
        { campo: "parser", valor: parserName },
        { campo: "versão do parser", valor: d.detection.parserVersion },
        { campo: "sinais de detecção", valor: d.detection.matchedSignals.join(" | ") || null },
        { campo: "período início", valor: statement.periodStart ?? null },
        { campo: "período fim", valor: statement.periodEnd ?? null },
        { campo: "saldo anterior (data)", valor: statement.openingBalance?.date ?? null },
        { campo: "saldo anterior", valor: statement.openingBalance?.amount ?? null },
        { campo: "saldo final (data)", valor: statement.closingBalance?.date ?? null },
        { campo: "saldo final", valor: statement.closingBalance?.amount ?? null },
        { campo: "raw items", valor: counts.rawItems },
        { campo: "rows", valor: counts.rows },
        { campo: "movimentações", valor: counts.transactions },
        { campo: "checkpoints", valor: counts.checkpoints },
        { campo: "validação", valor: d.validation.status },
        { campo: "diferença", valor: d.validation.math.difference },
        { campo: "problemas", valor: d.validation.problems.join(" | ") || null },
      ],
    },
  };
};
