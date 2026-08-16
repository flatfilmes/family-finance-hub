/**
 * Biblioteca de parsers de fatura de cartão.
 * O formato é escolhido por detecção; sem instituição reconhecida, usa o genérico.
 */
import { debugPdfPageLayout, extractPdfPageLayouts, layoutPageLines } from "@/lib/pdf-extract";
import { parseItauSpatial } from "./itau-spatial";
import { genericParser } from "./generic";
import { nubankParser } from "./nubank";
import { itauParser } from "./itau";
import { santanderParser } from "./santander";
import type { ParsedStatement, StatementParser } from "./types";

export const STATEMENT_PARSERS: StatementParser[] = [
  nubankParser,
  itauParser,
  santanderParser,
  genericParser,
];

export function pickStatementParser(linhas: string[]) {
  let escolhido = genericParser;
  let melhor = 0;
  for (const p of STATEMENT_PARSERS) {
    const score = p.detect(linhas);
    if (score > melhor) {
      melhor = score;
      escolhido = p;
    }
  }
  return { parser: escolhido, confianca: Math.max(melhor, 0.2) };
}

/** Lê um PDF de fatura e devolve cabeçalho + lançamentos. */
export async function readCardStatementPdf(file: Blob): Promise<ParsedStatement> {
  const pages = await extractPdfPageLayouts(file);
  const linhas = pages.flatMap((page) => layoutPageLines(page.items, page.width, page.page));
  const { parser } = pickStatementParser(linhas.map((l) => l.text));
  if (parser.id === "ITAU_PDF") {
    // ITAU_PDF é SEMPRE espacial: sem fallback linear, sem join global de página.
    const espacial = parseItauSpatial(pages);
    return { ...espacial, extraction_status: "READY", positional_debug: pages.map(debugPdfPageLayout) };
  }
  return parser.parse(linhas);
}

export * from "./types";
export {
  normalizeDescricao,
  classificarLancamento,
  lerCabecalho,
  lerLancamentos,
  parseGeneric,
} from "./generic";
