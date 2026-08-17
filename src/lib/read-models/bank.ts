import type { BankAccount } from "@/lib/bank-accounts";
import type { Transaction } from "@/lib/transactions";

/**
 * Read model canônico do LEDGER BANCÁRIO.
 *
 * Conta bancária representa DINHEIRO: o saldo nunca é recalculado a partir de
 * compras. Ele vem do ledger (saldo_atual mantido pelas operações canônicas) e
 * o fluxo do período vem das movimentações confirmadas.
 */
export type BankOverview = {
  period: string;
  contasAtivas: number;
  saldoTotal: number;
  entradas: number;
  saidas: number;
  pagamentosCartao: number;
  /** entradas - saídas - pagamentos de cartão no período. */
  liquido: number;
};

/** Saldo das contas ATIVAS — fonte única de "dinheiro em conta". */
export function sumBankBalances(accounts: BankAccount[]) {
  return accounts
    .filter((a) => a.ativo)
    .reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
}

export function buildBankOverview(input: {
  accounts: BankAccount[];
  transactions: Transaction[];
  /** Competência YYYY-MM; vazio = todo o histórico. */
  period?: string;
}): BankOverview {
  const period = input.period ?? "";
  const ids = new Set(input.accounts.map((a) => a.id));

  const movimentos = input.transactions.filter(
    (t) =>
      t.bank_account_id &&
      ids.has(t.bank_account_id) &&
      t.status !== "CANCELADA" &&
      (!period || t.data_movimento.startsWith(period)),
  );

  const soma = (tipo: Transaction["tipo"]) =>
    movimentos
      .filter((t) => t.tipo === tipo)
      .reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  const entradas = soma("ENTRADA");
  const saidas = soma("SAIDA");
  const pagamentosCartao = soma("PAGAMENTO_CARTAO");

  return {
    period,
    contasAtivas: input.accounts.filter((a) => a.ativo).length,
    saldoTotal: sumBankBalances(input.accounts),
    entradas,
    saidas,
    pagamentosCartao,
    liquido: entradas - saidas - pagamentosCartao,
  };
}
