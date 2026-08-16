/**
 * Contratos da arquitetura de leitura de faturas de cartão em PDF.
 *
 * Cada instituição pode ter o seu parser (generic / nubank / itau / santander).
 * Nenhum parser inventa dado: campo não identificado volta como `null`.
 */
import type { PdfLine } from "@/lib/pdf-extract";

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

export type ParsedStatement = StatementHeader & {
  parser: string;
  entries: StatementEntry[];
  linhas: string[];
};

export type StatementParser = {
  /** Identificador gravado na importação (ex.: GENERIC_PDF, NUBANK_PDF). */
  id: string;
  nome: string;
  /** Confiança de 0 a 1 de que este parser entende o arquivo. */
  detect: (linhas: string[]) => number;
  parse: (linhas: PdfLine[]) => ParsedStatement;
};
