/**
 * DRY RUN REAL do extrato bancário — função pura e reutilizável.
 *
 * Executa exatamente a mesma leitura da importação de produção
 * (PDF → pdf.js → rawItems → linhas visuais → detectBank → selectParser →
 * parse → ParsedBankStatement → validate), porém:
 *
 *   sem insert · sem update · sem Supabase · sem conciliação · sem ledger.
 *
 * Quem chama recebe o resultado REAL do parser: nada aqui é simulado.
 */
import {
  buildDiagnosticPackage,
  rawPdfDump,
  rawVisualLines,
  type DiagnosticPackage,
  type DiagnosticSource,
  type ParserDryRunResult,
  type RawPdfDump,
  type RawVisualLine,
} from "@/lib/pdf-diagnostic";
import { defaultDryRunForSource } from "@/lib/pdf-diagnostic/default-dry-runs";

export type BankStatementDryRunResult = {
  fileName: string;
  dump: RawPdfDump;
  visualRows: RawVisualLine[];
  /** Saída real do parser. `null` somente quando ele não pôde ser executado. */
  parser: ParserDryRunResult | null;
  package: DiagnosticPackage;
  error: string | null;
};

function falhaDoParser(
  file: File,
  dump: RawPdfDump,
  erro: Error,
): ParserDryRunResult {
  return {
    parser: "PARSER_EXECUTION_FAILED",
    bank: null,
    status: "PARSER_EXECUTION_FAILED",
    error: erro.message,
    stage: "PARSER_EXECUTION",
    signals: [],
    counts: { rawItems: dump.items.length, rows: 0, transactions: 0, checkpoints: 0 },
    output: { status: "PARSER_EXECUTION_FAILED", error: erro.message },
    debug: { accepted: [], rejected: [], metadata: [] },
    pipelineStages: [
      { stage: "PDFJS", status: "PASS", count: dump.items.length },
      { stage: "VISUAL_ROWS", status: "PASS" },
      { stage: "BANK_DETECTION", status: "FAIL" },
      { stage: "PARSER_SELECTION", status: "FAIL" },
      { stage: "PARSER_EXECUTION", status: "FAIL" },
      { stage: "VALIDATION", status: "FAIL" },
    ],
    errors: [
      {
        name: erro.name,
        message: erro.message,
        stage: "PARSER_EXECUTION",
        ...(erro.stack ? { stack: erro.stack } : {}),
        ...(erro.cause !== undefined ? { cause: String(erro.cause) } : {}),
      },
    ],
    parserInternalStages: [],
    parserExecutionInput: {
      parserName: null,
      bank: null,
      rawItemsCount: dump.items.length,
      fileName: file.name,
      executed: true,
      failed: true,
    },
    detection: {
      status: "FAILED",
      bank: null,
      matchedSignals: [],
      missingSignals: [],
      reason: erro.message,
    },
    parserInfo: { status: "NOT_FOUND", requestedBank: null, name: null },
  };
}

/**
 * Roda o pipeline completo em memória e devolve o pacote de diagnóstico já
 * montado com a saída REAL do parser.
 */
export async function runBankStatementDryRun(input: {
  file: File;
  source?: DiagnosticSource;
  page?: number | null;
}): Promise<BankStatementDryRunResult> {
  const source: DiagnosticSource = input.source ?? "BANK_STATEMENT";
  const dump = await rawPdfDump(input.file, input.file.name);
  const visualRows = rawVisualLines(dump.items);

  const dryRun = defaultDryRunForSource(source);
  let parser: ParserDryRunResult | null = null;
  let error: string | null = null;

  if (!dryRun) {
    error = "Nenhum parser está registrado para esta origem de documento.";
  } else {
    try {
      parser = await dryRun(input.file);
    } catch (e) {
      const erro = e instanceof Error ? e : new Error("Falha desconhecida no parser.");
      parser = falhaDoParser(input.file, dump, erro);
      error = erro.message;
    }
  }

  const pacote = buildDiagnosticPackage({
    source,
    dump,
    visualRows,
    parser,
    page: input.page ?? null,
  });

  return { fileName: dump.fileName, dump, visualRows, parser, package: pacote, error };
}
