/** Montagem do pacote de diagnóstico exportável (somente memória). */
import type { ParserDryRunResult, DiagnosticSource } from "@/lib/pdf-diagnostic/diagnostic-types";
import type { RawPdfDump, RawTextItem } from "@/lib/pdf-diagnostic/raw-dump";
import type { RawVisualLine } from "@/lib/pdf-diagnostic/visual-rows";
import { detectBankStatement, selectBankStatementParser } from "@/lib/bank-statements/parse";

export type DiagnosticDetectionStatus =
  | "DETECTED"
  | "DETECTION_NOT_EXECUTED"
  | "DETECTION_INPUT_EMPTY"
  | "PARSER_REGISTRY_MISS"
  | "PARSER_NOT_SELECTED"
  | string;

export type DiagnosticPackage = {
  source: DiagnosticSource;
  fileName: string;
  generatedAt: string;
  pages: RawPdfDump["pages"];
  rawItems: RawTextItem[];
  visualRows: RawVisualLine[];
  parser: {
    status: "FOUND" | "NOT_FOUND";
    requestedBank: string | null;
    name: string | null;
  };
  /** Entrada exata que a detecção recebeu (prova de que não veio vazia). */
  bankDetectionInput: {
    rawTextLength: number;
    rawTextPreview: string;
    rawItemsCount: number;
    visualRowsCount: number;
  };
  /** Detecção + parser selecionado, sempre presente quando houve dry run. */
  detection: {
    bank: string | null;
    parser: string | null;
    version: string | null;
    status: DiagnosticDetectionStatus | null;
    error: string | null;
    stage: string | null;
    signals: string[];
    counts: { rawItems: number; rows: number; transactions: number; checkpoints: number } | null;
    matchedSignals: string[];
    missingSignals: string[];
    score: number;
    reason: string;
  };
  parserOutput: unknown;
  checkpointTrace: unknown[];
  accepted: unknown[];
  rejected: unknown[];
  metadata: unknown[];
  pipelineStages: Array<{ stage: string; status: "PASS" | "FAIL"; count?: number }>;
  errors: Array<{ name: string; message: string; stage: string; stack?: string }>;
};

/** Texto usado pela detecção: linhas visuais reconstruídas + itens crus. */
function montarTextos(dump: RawPdfDump, visualRows: RawVisualLine[]): string[] {
  const linhas = visualRows
    .map((r) => r.items.map((i) => i.text).join(" ").replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const itens = dump.items.map((i) => i.text).filter(Boolean);
  return [...linhas, ...itens];
}

export function buildDiagnosticPackage(input: {
  source: DiagnosticSource;
  dump: RawPdfDump;
  visualRows: RawVisualLine[];
  parser: ParserDryRunResult | null;
  /** Quando informado, limita o pacote a uma única página. */
  page?: number | null;
}): DiagnosticPackage {
  const filtro = input.page ?? null;
  const pages = filtro ? input.dump.pages.filter((p) => p.page === filtro) : input.dump.pages;

  const ehExtrato = input.source === "BANK_STATEMENT" || input.source === "GENERIC_PDF";
  const textos = montarTextos(input.dump, input.visualRows);
  const rawText = textos.join("\n");
  const bankDetectionInput = {
    rawTextLength: rawText.length,
    rawTextPreview: rawText.slice(0, 1200),
    rawItemsCount: input.dump.items.length,
    visualRowsCount: input.visualRows.length,
  };

  // A detecção NUNCA depende do dry run: quando ele não rodou, ela é executada
  // aqui com o mesmo detector da importação real (função pura, sem persistência).
  const dryRunDetection = input.parser?.detection ?? null;
  const local = ehExtrato && !dryRunDetection ? detectBankStatement(textos) : null;
  const selecaoLocal = local ? selectBankStatementParser(local.bank) : null;

  const bank = dryRunDetection?.bank ?? input.parser?.bank ?? local?.bank ?? null;
  const matchedSignals =
    dryRunDetection?.matchedSignals ?? input.parser?.signals ?? local?.matchedSignals ?? [];
  const missingSignals = dryRunDetection?.missingSignals ?? local?.missingSignals ?? [];

  const parserInfo =
    input.parser?.parserInfo ??
    selecaoLocal ??
    { status: "NOT_FOUND" as const, requestedBank: input.parser?.bank ?? null, name: null };

  const statusDeteccao: DiagnosticDetectionStatus = dryRunDetection
    ? (dryRunDetection.status === "PASS" ? "DETECTED" : (input.parser?.status ?? "PARSER_NOT_SELECTED"))
    : !local
      ? "DETECTION_NOT_EXECUTED"
      : bankDetectionInput.rawTextLength === 0
        ? "DETECTION_INPUT_EMPTY"
        : local.bank && parserInfo.status === "NOT_FOUND"
          ? "PARSER_REGISTRY_MISS"
          : local.bank
            ? "DETECTED"
            : "PARSER_NOT_SELECTED";

  const reason =
    dryRunDetection?.reason ??
    local?.reason ??
    (statusDeteccao === "DETECTION_INPUT_EMPTY"
      ? "A detecção recebeu texto vazio."
      : "O pipeline do parser não foi executado.");

  const deteccaoOk = statusDeteccao === "DETECTED";
  const stagesFallback: DiagnosticPackage["pipelineStages"] = [
    { stage: "PDFJS", status: input.dump.items.length ? "PASS" : "FAIL", count: input.dump.items.length },
    { stage: "VISUAL_ROWS", status: input.visualRows.length ? "PASS" : "FAIL", count: input.visualRows.length },
    { stage: "BANK_DETECTION", status: deteccaoOk ? "PASS" : "FAIL" },
    { stage: "PARSER_SELECTION", status: parserInfo.status === "FOUND" ? "PASS" : "FAIL" },
    { stage: "PARSER_EXECUTION", status: "FAIL" },
    { stage: "VALIDATION", status: "FAIL" },
  ];

  return {
    source: input.source,
    fileName: input.dump.fileName,
    generatedAt: new Date().toISOString(),
    pages,
    rawItems: filtro ? input.dump.items.filter((i) => i.page === filtro) : input.dump.items,
    visualRows: filtro ? input.visualRows.filter((r) => r.page === filtro) : input.visualRows,
    parser: parserInfo,
    bankDetectionInput,
    detection: {
      bank,
      parser: input.parser?.parser ?? parserInfo.name,
      version: input.parser?.version ?? null,
      status: statusDeteccao,
      error: input.parser?.error ?? null,
      stage: input.parser?.stage ?? null,
      signals: matchedSignals,
      counts: input.parser?.counts ?? null,
      matchedSignals,
      missingSignals,
      score: matchedSignals.length,
      reason,
    },
    parserOutput: input.parser?.output ?? null,
    checkpointTrace: input.parser?.checkpointTrace ?? [],
    accepted: input.parser?.debug?.accepted ?? [],
    rejected: input.parser?.debug?.rejected ?? [],
    metadata: input.parser?.debug?.metadata ?? [],
    pipelineStages: input.parser?.pipelineStages ?? stagesFallback,
    errors: input.parser?.errors ?? [],
  };
}
