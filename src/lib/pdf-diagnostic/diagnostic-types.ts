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
/** Status explícito do pipeline de parsing (nunca silenciosamente nulo). */
export type ParserDryRunStatus = "OK" | "PARSER_NOT_SELECTED" | "PARSER_EXECUTION_FAILED";

/** Rastreio linha → checkpoint (usado nos extratos bancários). */
export type ParserCheckpointTrace = {
  row: string;
  page?: number | null;
  status: string;
  date: string | null;
  balance: number | null;
  reason: string;
};

/**
 * Status de uma etapa do pipeline.
 * FAIL = etapa obrigatória do pipeline escolhido falhou.
 * NOT_APPLICABLE/SKIPPED = etapa pertence a outra família de parser.
 */
export type ParserStageStatus = "PASS" | "FAIL" | "SKIPPED" | "NOT_APPLICABLE";

/** Família de parser efetivamente executada. */
export type ParserFamily = "BANK_STATEMENT" | "CARD_STATEMENT" | "PURCHASE_RECEIPT" | "NONE";

export type ParserDryRunResult = {
  /** Família do pipeline executado (define quais etapas são obrigatórias). */
  family?: ParserFamily;
  /** Status global coerente do diagnóstico. */
  diagnosticStatus?: "PASS" | "FAIL";
  /** Dry run: gravação nunca é permitida nesta camada. */
  persistenceAllowed?: boolean;
  /** Detecção de emissor do cartão (exclusiva de faturas). */
  cardDetection?: {
    status: "DETECTED" | "NOT_DETECTED" | "NOT_APPLICABLE";
    issuer?: string | null;
    parser?: string | null;
  };
  /** Detecção bancária — NOT_APPLICABLE quando o documento não é extrato. */
  bankDetection?: { status: "DETECTED" | "NOT_DETECTED" | "NOT_APPLICABLE" };
  /** Identificação do parser usado (ex.: ITAU_PDF, NOTA_FISCAL). */
  parser: string;
  /** Banco/emissor detectado, quando aplicável. */
  bank?: string | null;
  /** Versão do parser selecionado. */
  version?: string | null;
  status?: ParserDryRunStatus;
  error?: string | null;
  /** Etapa em que o pipeline parou, quando parou. */
  stage?: string | null;
  /** Sinais de detecção encontrados no documento. */
  signals?: string[];
  detection?: {
    status: "PASS" | "FAILED";
    bank: string | null;
    matchedSignals: string[];
    missingSignals: string[];
    reason: string;
  };
  parserInfo?: {
    status: "FOUND" | "NOT_FOUND";
    requestedBank: string | null;
    name: string | null;
  };
  counts?: { rawItems: number; rows: number; transactions: number; checkpoints: number };
  checkpointTrace?: ParserCheckpointTrace[];
  pipelineStages?: Array<{ stage: string; status: "PASS" | "FAIL"; count?: number }>;
  /** Etapas internas do parser (HEADER_PERIOD, TRANSACTION_ROWS, ...). */
  parserInternalStages?: Array<{ stage: string; status: "PASS" | "FAIL"; reason: string }>;
  /** Entrada exata que o parser recebeu — prova de execução. */
  parserExecutionInput?: Record<string, unknown> | null;
  errors?: Array<{ name: string; message: string; stage: string; stack?: string; cause?: string }>;
  /** Saída do parser exatamente como ele devolve hoje. */
  output: unknown;
  debug?: ParserDebug;
};

/**
 * Função fornecida por cada módulo. Recebe o arquivo e devolve o que o parser
 * entendeu. Obrigatoriamente em memória: nada de banco, storage ou saldo.
 */
export type ParserDryRun = (file: Blob) => Promise<ParserDryRunResult>;
