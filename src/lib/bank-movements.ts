import { supabase } from "@/integrations/supabase/client";

/**
 * Movimentações bancárias manuais.
 *
 * Regra central do produto: movimentação bancária NÃO é receita nem despesa.
 * Um depósito apenas aumenta o saldo da conta; uma retirada apenas reduz.
 * A classificação econômica (receita, gasto, transferência) é opcional e
 * fica registrada na `natureza` do lançamento.
 */
export type MovementDirection = "ENTRADA" | "SAIDA";

export type MovementNature =
  | "DINHEIRO"
  | "RECEITA"
  | "TRANSFERENCIA_EXTERNA"
  | "ESTORNO"
  | "DESPESA"
  | "OUTRO";

export const MOVEMENT_NATURE_LABELS: Record<MovementNature, string> = {
  DINHEIRO: "Dinheiro em espécie",
  RECEITA: "Receita",
  TRANSFERENCIA_EXTERNA: "Transferência externa",
  ESTORNO: "Estorno",
  DESPESA: "Despesa",
  OUTRO: "Outro",
};

/** Origens oferecidas para um depósito (entrada de dinheiro na conta). */
export const DEPOSIT_NATURES: MovementNature[] = [
  "DINHEIRO",
  "RECEITA",
  "TRANSFERENCIA_EXTERNA",
  "ESTORNO",
  "OUTRO",
];

/** Naturezas oferecidas para uma retirada (saída de dinheiro da conta). */
export const WITHDRAWAL_NATURES: MovementNature[] = [
  "DINHEIRO",
  "DESPESA",
  "TRANSFERENCIA_EXTERNA",
  "OUTRO",
];

/**
 * Registra um depósito ou uma retirada no ledger (`transactions`).
 * O saldo da conta é atualizado exclusivamente pelo servidor, que também
 * valida família, conta e permissão de quem está lançando.
 */
export async function registerBankMovement(input: {
  accountId: string;
  direcao: MovementDirection;
  valor: number;
  data: string;
  descricao?: string;
  natureza: MovementNature;
  incomeId?: string;
  observacao?: string;
}) {
  const { data, error } = await supabase.rpc("register_bank_movement", {
    _account_id: input.accountId,
    _direcao: input.direcao,
    _valor: input.valor,
    _data: input.data,
    _natureza: input.natureza,
    ...(input.descricao ? { _descricao: input.descricao } : {}),
    ...(input.incomeId ? { _income_id: input.incomeId } : {}),
    ...(input.observacao ? { _observacao: input.observacao } : {}),
  });
  if (error) throw error;
  return data as string;
}

/**
 * Estorna uma movimentação sem apagar o histórico: cria o lançamento contrário.
 * Em transferências internas, os dois lados são revertidos na mesma operação.
 */
export async function reverseBankTransaction(input: { transactionId: string; motivo?: string }) {
  const { data, error } = await supabase.rpc("reverse_bank_transaction", {
    _transaction_id: input.transactionId,
    ...(input.motivo ? { _motivo: input.motivo } : {}),
  });
  if (error) throw error;
  return data as string;
}
