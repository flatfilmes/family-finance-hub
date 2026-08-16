/** Parser especializado do Nubank — herda a leitura genérica e ajusta o cabeçalho. */
import type { PdfLine } from "@/lib/pdf-extract";
import { parseGeneric, semAcento } from "./generic";
import type { StatementParser } from "./types";

export const nubankParser: StatementParser = {
  id: "NUBANK_PDF",
  nome: "Nubank",
  detect: (linhas) => {
    const texto = semAcento(linhas.join(" ")).toLowerCase();
    if (texto.includes("nu pagamentos") || texto.includes("nubank")) return 0.9;
    return 0;
  },
  parse: (linhas: PdfLine[]) => {
    const base = parseGeneric(linhas);
    return { ...base, parser: "NUBANK_PDF", emissor: base.emissor ?? "NUBANK" };
  },
};
