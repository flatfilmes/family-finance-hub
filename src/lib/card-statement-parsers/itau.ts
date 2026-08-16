/** Parser especializado do Itaú — herda a leitura genérica e ajusta o cabeçalho. */
import type { PdfLine } from "@/lib/pdf-extract";
import { parseGeneric, semAcento } from "./generic";
import type { StatementParser } from "./types";

export const itauParser: StatementParser = {
  id: "ITAU_PDF",
  nome: "Itaú",
  detect: (linhas) => {
    const texto = semAcento(linhas.join(" ")).toLowerCase();
    if (texto.includes("itau unibanco") || texto.includes("itaucard") || texto.includes("itau"))
      return 0.85;
    return 0;
  },
  parse: (linhas: PdfLine[]) => {
    const base = parseGeneric(linhas);
    return { ...base, parser: "ITAU_PDF", emissor: base.emissor ?? "ITAU" };
  },
};
