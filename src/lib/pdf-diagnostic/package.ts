/** Montagem do pacote de diagnóstico exportável (somente memória). */
import type { ParserDryRunResult, DiagnosticSource } from "@/lib/pdf-diagnostic/diagnostic-types";
import type { RawPdfDump, RawTextItem } from "@/lib/pdf-diagnostic/raw-dump";
import type { RawVisualLine } from "@/lib/pdf-diagnostic/visual-rows";

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
  /** Detecção + parser selecionado, sempre presente quando houve dry run. */
  detection: {
    bank: string | null;
    parser: string | null;
    version: string | null;
    status: string | null;
    error: string | null;
    stage: string | null;
    signals: string[];
    counts: { rawItems: number; rows: number; transactions: number; checkpoints: number } | null;
    matchedSignals: string[];
    missingSignals: string[];
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
  return {
    source: input.source,
    fileName: input.dump.fileName,
    generatedAt: new Date().toISOString(),
    pages,
    rawItems: filtro ? input.dump.items.filter((i) => i.page === filtro) : input.dump.items,
    visualRows: filtro ? input.visualRows.filter((r) => r.page === filtro) : input.visualRows,
    parser: input.parser?.parserInfo ?? {
      status: "NOT_FOUND",
      requestedBank: input.parser?.bank ?? null,
      name: null,
    },
    detection: {
      bank: input.parser?.detection?.bank ?? input.parser?.bank ?? null,
      parser: input.parser?.parser ?? null,
      version: input.parser?.version ?? null,
      status: input.parser?.detection?.status ?? input.parser?.status ?? "PARSER_NOT_SELECTED",
      error: input.parser?.error ?? null,
      stage: input.parser?.stage ?? null,
      signals: input.parser?.signals ?? [],
      counts: input.parser?.counts ?? null,
      matchedSignals: input.parser?.detection?.matchedSignals ?? input.parser?.signals ?? [],
      missingSignals: input.parser?.detection?.missingSignals ?? [],
      reason: input.parser?.detection?.reason ?? "O pipeline do parser não foi executado.",
    },
    parserOutput: input.parser?.output ?? null,
    checkpointTrace: input.parser?.checkpointTrace ?? [],
    accepted: input.parser?.debug?.accepted ?? [],
    rejected: input.parser?.debug?.rejected ?? [],
    metadata: input.parser?.debug?.metadata ?? [],
    pipelineStages: input.parser?.pipelineStages ?? [
      { stage: "PDFJS", status: input.dump.items.length ? "PASS" : "FAIL", count: input.dump.items.length },
      { stage: "VISUAL_ROWS", status: input.visualRows.length ? "PASS" : "FAIL", count: input.visualRows.length },
      { stage: "BANK_DETECTION", status: "FAIL" },
      { stage: "PARSER_SELECTION", status: "FAIL" },
      { stage: "PARSER_EXECUTION", status: "FAIL" },
      { stage: "VALIDATION", status: "FAIL" },
    ],
    errors: input.parser?.errors ?? [],
  };
}
