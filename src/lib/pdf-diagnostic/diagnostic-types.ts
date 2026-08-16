/**
 * Contratos do MODO DIAGNÓSTICO DE PDF (ferramenta técnica, reutilizável).
 *
 * Esta camada não conhece Itaú, DANFE, NFC-e ou qualquer regra de negócio:
 * ela apenas lê o PDF e recebe, de cada módulo, uma função de "dry run" que
 * devolve o que o parser daquele módulo interpretou — sem persistir nada.
 */

/** Módulo de origem do arquivo (apenas rótulo — não muda a leitura bruta). */
export type DiagnosticSource =
  | "CARD_STATEMENT"
  | "PURCHASE_RECEIPT"
  | "BANK_STATEMENT"
  | "GENERIC_PDF";

export const DIAGNOSTIC_SOURCE_LABELS: Record<DiagnosticSource, string> = {
  CARD_STATEMENT: "Fatura de cartão",
  PURCHASE_RECEIPT: "Nota fiscal / cupom",
  BANK_STATEMENT: "Extrato bancário",
  GENERIC_PDF: "Documento genérico",
};

/** Linha bruta aceita pelo parser (o que virou dado). */
export type ParserAccepted = {
  raw: string;
  valor?: number | null;
  page?: number | null;
  detalhe?: string | null;
};

/** Linha bruta descartada pelo parser, com o motivo declarado. */
export type ParserRejected = {
  raw: string;
  valor?: number | null;
  page?: number | null;
  x?: number | null;
  y?: number | null;
  reason: string;
};

/** Diagnóstico padronizado que qualquer parser de documento pode devolver. */
export type ParserDebug = {
  accepted: ParserAccepted[];
  rejected: ParserRejected[];
  metadata: { campo: string; valor: string | number | null }[];
};

/** Resultado de um parser em modo diagnóstico (dry run, sem persistência). */
export type ParserDryRunResult = {
  /** Identificação do parser usado (ex.: ITAU_PDF, NOTA_FISCAL). */
  parser: string;
  /** Saída do parser exatamente como ele devolve hoje. */
  output: unknown;
  debug?: ParserDebug;
};

/**
 * Função fornecida por cada módulo. Recebe o arquivo e devolve o que o parser
 * entendeu. Obrigatoriamente em memória: nada de banco, storage ou saldo.
 */
export type ParserDryRun = (file: Blob) => Promise<ParserDryRunResult>;
