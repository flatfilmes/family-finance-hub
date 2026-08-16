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
  parser: string | null;
  parserOutput: unknown;
  accepted: unknown[];
  rejected: unknown[];
  metadata: unknown[];
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
    parser: input.parser?.parser ?? null,
    parserOutput: input.parser?.output ?? null,
    accepted: input.parser?.debug?.accepted ?? [],
    rejected: input.parser?.debug?.rejected ?? [],
    metadata: input.parser?.debug?.metadata ?? [],
  };
}
