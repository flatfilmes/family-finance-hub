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
import {
  detectDocumentType,
  type DocumentType,
  type DocumentTypeDetection,
} from "@/lib/pdf-diagnostic/document-type";

export type BankStatementDryRunResult = {
  fileName: string;
  dump: RawPdfDump;
  visualRows: RawVisualLine[];
  /** Tipo econômico do documento, detectado ANTES de qualquer parser. */
  documentType: DocumentTypeDetection;
  /** Origem informada pela tela (rótulo) × tipo realmente detectado. */
  routing: {
    requestedSource: DiagnosticSource;
    documentType: DocumentType;
    parserFamily: "BANK_STATEMENT" | "CARD_STATEMENT" | "PURCHASE_RECEIPT" | "NONE";
    status: "OK" | "WRONG_DOCUMENT_TYPE_FOR_BANK_STATEMENT" | "DOCUMENT_TYPE_UNKNOWN";
    reason: string;
  };
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

  // ETAPA 1 — TIPO ECONÔMICO DO DOCUMENTO (antes da detecção de banco).
  const textos = [
    ...visualRows.map((r) => r.items.map((i) => i.text).join(" ")),
    ...dump.items.map((i) => i.text),
  ];
  const documentType = detectDocumentType(textos);

  // ETAPA 2 — ROTEAMENTO POR TIPO, nunca só pela marca do banco.
  const familia =
    documentType.type === "CREDIT_CARD_STATEMENT"
      ? "CARD_STATEMENT"
      : documentType.type === "RECEIPT"
        ? "PURCHASE_RECEIPT"
        : documentType.type === "BANK_STATEMENT"
          ? "BANK_STATEMENT"
          : "NONE";

  const sourceEfetiva: DiagnosticSource =
    familia === "NONE" ? source : (familia as DiagnosticSource);

  const routing: BankStatementDryRunResult["routing"] = {
    requestedSource: source,
    documentType: documentType.type,
    parserFamily: familia,
    status:
      familia === "NONE"
        ? "DOCUMENT_TYPE_UNKNOWN"
        : source === "BANK_STATEMENT" && familia !== "BANK_STATEMENT"
          ? "WRONG_DOCUMENT_TYPE_FOR_BANK_STATEMENT"
          : "OK",
    reason: documentType.reason,
  };

  const dryRun = defaultDryRunForSource(sourceEfetiva);
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
    source: sourceEfetiva,
    dump,
    visualRows,
    parser,
    page: input.page ?? null,
  });

  return {
    fileName: dump.fileName,
    dump,
    visualRows,
    documentType,
    routing,
    parser,
    package: { ...pacote, documentType, routing },
    error,
  };
}
