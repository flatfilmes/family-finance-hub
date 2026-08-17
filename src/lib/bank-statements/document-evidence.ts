/**
 * EVIDÊNCIA DOCUMENTAL DAS LINHAS EM COLISÃO — SOMENTE LEITURA.
 *
 * `bank_statement_items` não guarda o número do documento nem o texto cru da
 * linha (essas colunas nunca existiram). Para poder provar QUAL das linhas
 * repetidas está ausente do ledger, os números de documento conferidos no PDF
 * ficam declarados aqui, ancorados em período + ordem + data + valor.
 *
 * Isto NÃO é dado inventado nem substitui o documento: é o retrato conferido
 * do PDF, usado apenas para exibição e prova. Nada aqui grava ou altera valor,
 * data ou sentido de qualquer movimento.
 */
export type DocumentEvidence = {
  /** periodo_inicio da importação, para ancorar sem depender de UUID. */
  periodStart: string;
  ordem: number;
  data: string;
  /** Valor com sinal, como no documento. */
  valor: number;
  documentNumber: string;
  rawText: string;
};

export const BB_DOCUMENT_EVIDENCE: DocumentEvidence[] = [
  {
    periodStart: "2026-04-01",
    ordem: 1,
    data: "2026-04-02",
    valor: 54.61,
    documentNumber: "21858419958872",
    rawText: "02/04 Pix - Rejeitado · PIX NAO EFETUADO. ERRO NO 21858419958872 54,61 C",
  },
  {
    periodStart: "2026-04-01",
    ordem: 2,
    data: "2026-04-02",
    valor: -54.61,
    documentNumber: "40201",
    rawText: "02/04 Pix - Enviado · PIX Marketplace 40201 54,61 D",
  },
  {
    periodStart: "2026-04-01",
    ordem: 3,
    data: "2026-04-02",
    valor: -54.61,
    documentNumber: "40202",
    rawText: "02/04 Pix - Enviado · PIX Marketplace 40202 54,61 D",
  },
];

export function documentEvidenceFor(
  periodStart: string | null,
  ordem: number,
): DocumentEvidence | null {
  if (!periodStart) return null;
  return (
    BB_DOCUMENT_EVIDENCE.find((e) => e.periodStart === periodStart && e.ordem === ordem) ?? null
  );
}
