/** Parser especializado do Santander — herda a leitura genérica e ajusta o cabeçalho. */
import type { PdfLine } from "@/lib/pdf-extract";
import { parseGeneric, semAcento } from "./generic";
import type { StatementParser } from "./types";

export const santanderParser: StatementParser = {
  id: "SANTANDER_PDF",
  nome: "Santander",
  detect: (linhas) => {
    const texto = semAcento(linhas.join(" ")).toLowerCase();
    if (texto.includes("santander")) return 0.85;
    return 0;
  },
  parse: (linhas: PdfLine[]) => {
    const base = parseGeneric(linhas);
    return { ...base, parser: "SANTANDER_PDF", emissor: base.emissor ?? "SANTANDER" };
  },
};
