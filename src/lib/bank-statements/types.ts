import type { Database } from "@/integrations/supabase/types";

export type BankStatementImport = Database["public"]["Tables"]["bank_statement_imports"]["Row"];
export type BankStatementItem = Database["public"]["Tables"]["bank_statement_items"]["Row"];
export type BankMovementKind = Database["public"]["Enums"]["bank_movement_kind"];
export type BankStatementMatch = Database["public"]["Enums"]["bank_statement_match"];
export type BankStatementFormat = Database["public"]["Enums"]["bank_statement_format"];
export type BankStatementStatus = Database["public"]["Enums"]["bank_statement_status"];

export const MOVEMENT_KIND_LABELS: Record<BankMovementKind, string> = {
  ENTRADA: "Entrada",
  SAIDA: "Saída",
  TRANSFERENCIA: "Transferência",
  TARIFA: "Tarifa",
  JUROS: "Juros",
  ESTORNO: "Estorno",
  AJUSTE: "Ajuste",
  OUTRO: "Outro",
};

export const MOVEMENT_KINDS = Object.keys(MOVEMENT_KIND_LABELS) as BankMovementKind[];

export const MATCH_LABELS: Record<BankStatementMatch, string> = {
  MATCHED: "Já existe no sistema",
  POSSIBLE_MATCH: "Possível correspondência",
  DIVERGENT: "Divergente",
  NEW: "Novo lançamento",
  IGNORED: "Ignorado",
};

/** Ação escolhida na revisão — decide o efeito financeiro da confirmação. */
export type ReviewAction =
  | "ASSOCIATE_EXISTING"
  | "CREATE_TRANSACTION"
  | "CREATE_PURCHASE"
  | "MATCH_INCOME"
  | "MATCH_TRANSFER"
  | "MATCH_CARD_PAYMENT"
  | "REGISTER_FEE"
  | "REGISTER_REFUND"
  | "IGNORE";

export const REVIEW_ACTION_LABELS: Record<ReviewAction, string> = {
  ASSOCIATE_EXISTING: "Associar ao que já existe",
  CREATE_TRANSACTION: "Criar movimentação",
  CREATE_PURCHASE: "Criar compra",
  MATCH_INCOME: "Registrar recebimento da receita",
  MATCH_TRANSFER: "Registrar transferência entre contas",
  MATCH_CARD_PAYMENT: "Associar pagamento de fatura",
  REGISTER_FEE: "Registrar tarifa",
  REGISTER_REFUND: "Registrar estorno",
  IGNORE: "Ignorar",
};

export const REVIEW_ACTIONS = Object.keys(REVIEW_ACTION_LABELS) as ReviewAction[];

/** Ações que não produzem nenhum efeito financeiro novo. */
export const ACOES_SEM_EFEITO: ReviewAction[] = ["IGNORE", "ASSOCIATE_EXISTING"];


/**
 * Natureza semântica declarada pelo próprio extrato (quando o banco informa).
 * Não substitui `tipo`: apenas qualifica o lançamento para a conciliação.
 */
export type StatementSemanticKind =
  | "PIX"
  | "TRANSFER"
  | "CARD_PAYMENT"
  | "INVESTMENT_INCOME"
  | "INVESTMENT"
  | "FEE"
  | "REFUND"
  | "OTHER";

/** Lançamento lido de um extrato, ainda sem nenhuma persistência. */
export type ParsedBankMovement = {
  /** Data contábil oficial da coluna "Dia". */
  data: string | null;
  /** Data citada no histórico; metadata que nunca substitui `data`. */
  eventDate?: string | null;
  descricaoOriginal: string;
  descricaoNormalizada: string;
  /** Sinal preservado: positivo entra na conta, negativo sai. */
  valor: number;
  tipo: BankMovementKind;
  /** Classificação semântica do banco (pagamento de fatura, rendimento, PIX...). */
  semantica?: StatementSemanticKind;
};

/** Saldo impresso pelo banco em um dia — conferência, nunca movimentação. */
export type ParsedBalanceCheckpoint = {
  data: string;
  saldo: number;
  rotulo?: string | null;
};

/** Resultado completo da leitura de um extrato (dry run). */
export type ParsedBankStatement = {
  parser: string;
  periodoInicio: string | null;
  periodoFim: string | null;
  saldoInicial: number | null;
  saldoFinal: number | null;
  movimentos: ParsedBankMovement[];
  /** Saldos diários impressos no documento ("Saldo do dia", "S A L D O"). */
  checkpoints?: ParsedBalanceCheckpoint[];
  /**
   * Saldo informado fora do período (ex.: "saldo do dia" atual impresso no topo
   * de um extrato histórico). Referência do documento, nunca checkpoint.
   */
  saldoReferenciaAtual?: { data: string; saldo: number } | null;
  /** Lançamentos futuros (previstos): nunca entram no período realizado. */
  futuros?: ParsedBankMovement[];

  /** Dados institucionais lidos do documento, apenas para exibição. */
  identificacao?: {
    banco: string | null;
    agencia: string | null;
    conta: string | null;
    titular: string | null;
  };
  aceitos: { raw: string; valor: number | null; page?: number | null }[];
  rejeitados: { raw: string; valor: number | null; page?: number | null; reason: string }[];
};
