/**
 * Contratos da arquitetura de leitura de faturas de cartão em PDF.
 *
 * Cada instituição pode ter o seu parser (generic / nubank / itau / santander).
 * Nenhum parser inventa dado: campo não identificado volta como `null`.
 */
import type { PdfLine, PdfPageLayout, PdfPageLayoutDebug } from "@/lib/pdf-extract";

export type StatementItemKind =
  | "COMPRA"
  | "PAGAMENTO"
  | "ESTORNO"
  | "JUROS"
  | "TAXA"
  | "AJUSTE"
  | "OUTRO";

export type StatementEntry = {
  /** Data do lançamento na fatura (ISO) ou null quando não identificada. */
  data_lancamento: string | null;
  /** Texto exatamente como veio na fatura. */
  descricao_original: string;
  /** Descrição normalizada (sem acento, caixa alta, sem ruído). */
  descricao_normalizada: string;
  /** Estabelecimento sugerido — só quando há evidência no texto. */
  estabelecimento_sugerido: string | null;
  valor: number;
  parcela_atual: number | null;
  total_parcelas: number | null;
  tipo_sugerido: StatementItemKind;
  /** Final do cartão (4 dígitos) ao qual o lançamento pertence, quando a fatura informa. */
  card_last4?: string | null;
  /** Categoria impressa pelo próprio banco na fatura (apenas sugestão). */
  categoria_banco?: string | null;
  /** Registro possivelmente mesclado de duas colunas — exige revisão manual. */
  ambiguo?: boolean;
};

export type StatementHeader = {
  emissor: string | null;
  titular: string | null;
  final_cartao: string | null;
  data_fechamento: string | null;
  data_vencimento: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  valor_total_fatura: number | null;
};

/** Informações da fatura que NUNCA viram lançamento (limites, projeções, totais). */
export type StatementMetadata = {
  data_emissao?: string | null;
  total_fatura_anterior?: number | null;
  pagamento_anterior?: number | null;
  lancamentos_atuais?: number | null;
  limite_credito?: number | null;
  limite_disponivel?: number | null;
  limite_utilizado?: number | null;
  next_invoice_amount?: number | null;
  future_invoices_amount?: number | null;
  future_commitments_total?: number | null;
};

/** Subtotal impresso pelo banco por cartão (usado só para validação). */
export type StatementCardSubtotal = { card_last4: string; valor: number };

export type ParsedStatement = StatementHeader & {
  parser: string;
  entries: StatementEntry[];
  linhas: string[];
  /** Metadados da fatura (limites, projeções, totais auxiliares). */
  metadata?: StatementMetadata;
  /** Subtotais por cartão declarados na fatura. */
  subtotais?: StatementCardSubtotal[];
  /** Parcelas de próximas faturas — informativas, fora do ciclo atual. */
  futuras?: StatementEntry[];
  extraction_status?: "READY" | "REVIEW_REQUIRED";
  positional_debug?: PdfPageLayoutDebug[];
};

export type StatementParser = {
  /** Identificador gravado na importação (ex.: GENERIC_PDF, NUBANK_PDF). */
  id: string;
  nome: string;
  /** Confiança de 0 a 1 de que este parser entende o arquivo. */
  detect: (linhas: string[]) => number;
  parse: (linhas: PdfLine[]) => ParsedStatement;
  parseLayout?: (pages: PdfPageLayout[]) => ParsedStatement;
};
