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
  NEW: "Novo lançamento",
  IGNORED: "Ignorado",
};

/** Lançamento lido de um extrato, ainda sem nenhuma persistência. */
export type ParsedBankMovement = {
  data: string | null;
  descricaoOriginal: string;
  descricaoNormalizada: string;
  /** Sinal preservado: positivo entra na conta, negativo sai. */
  valor: number;
  tipo: BankMovementKind;
};

/** Resultado completo da leitura de um extrato (dry run). */
export type ParsedBankStatement = {
  parser: string;
  periodoInicio: string | null;
  periodoFim: string | null;
  saldoInicial: number | null;
  saldoFinal: number | null;
  movimentos: ParsedBankMovement[];
  aceitos: { raw: string; valor: number | null; page?: number | null }[];
  rejeitados: { raw: string; valor: number | null; page?: number | null; reason: string }[];
};
