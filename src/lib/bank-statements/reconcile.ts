/**
 * Conciliação do extrato com o que já existe no sistema.
 *
 * Regra central: se o lançamento do extrato já está representado no sistema
 * (compra no PIX/débito, pagamento de fatura, transferência entre contas da
 * própria família), ele NÃO pode virar uma nova movimentação — apenas se
 * associa ao registro existente.
 */
import { semAcento } from "@/lib/card-statement-parsers/generic";
import type { BankAccount } from "@/lib/bank-accounts";
import type { Purchase } from "@/lib/purchases";
import type { CardInvoice } from "@/lib/card-invoices";
import type { BankStatementMatch, ParsedBankMovement } from "./types";

export type ReconcileSuggestion = {
  matchStatus: BankStatementMatch;
  confidence: number;
  purchaseId?: string;
  cardInvoiceId?: string;
  transferAccountId?: string;
  motivo: string;
};

const diasEntre = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;

const parecido = (a: string, b: string) => {
  const x = semAcento(a).toUpperCase();
  const y = semAcento(b).toUpperCase();
  if (!x || !y) return false;
  return x.includes(y) || y.includes(x);
};

/** Sugere o estado de conciliação de um lançamento do extrato. */
export function reconcileMovement(
  mov: ParsedBankMovement,
  contexto: {
    accountId: string;
    purchases: Purchase[];
    invoices: CardInvoice[];
    accounts: BankAccount[];
  },
): ReconcileSuggestion {
  const valor = Math.abs(mov.valor);
  const data = mov.data;

  // 1. Pagamento de fatura de cartão já registrado ou já existente no sistema.
  const textoPlano = semAcento(mov.descricaoOriginal).toLowerCase();
  const pareceCartao =
    textoPlano.includes("cartao") || textoPlano.includes("fatura") || textoPlano.includes("card");
  if (mov.valor < 0 && pareceCartao) {
    const fatura = contexto.invoices.find(
      (f) =>
        Math.abs(Number(f.valor_total) - valor) <= 0.02 &&
        (!data || diasEntre(f.data_vencimento, data) <= 7),
    );
    if (fatura) {
      return {
        matchStatus: fatura.status === "PAGA" ? "MATCHED" : "POSSIBLE_MATCH",
        confidence: fatura.status === "PAGA" ? 95 : 80,
        cardInvoiceId: fatura.id,
        motivo:
          fatura.status === "PAGA"
            ? "Pagamento desta fatura já registrado no sistema"
            : "Corresponde a uma fatura em aberto — associe ao pagamento da fatura",
      };
    }
  }

  // 2. Compra já lançada e paga por esta conta (PIX, débito, transferência).
  const compra = contexto.purchases.find(
    (p) =>
      p.bank_account_id === contexto.accountId &&
      Math.abs(Number(p.valor_total) - valor) <= 0.02 &&
      (!data ||
        diasEntre(p.data_pagamento_real ?? p.data_compra, data) <= 3),
  );
  if (compra) {
    return {
      matchStatus: "MATCHED",
      confidence: parecido(mov.descricaoOriginal, compra.estabelecimento) ? 95 : 85,
      purchaseId: compra.id,
      motivo: `Compra já cadastrada: ${compra.estabelecimento}`,
    };
  }

  // 3. Transferência entre contas da própria família.
  const outraConta = contexto.accounts.find(
    (a) =>
      a.id !== contexto.accountId &&
      (parecido(mov.descricaoOriginal, a.banco) || parecido(mov.descricaoOriginal, a.nome_conta)),
  );
  if (outraConta || mov.tipo === "TRANSFERENCIA") {
    return {
      matchStatus: "POSSIBLE_MATCH",
      confidence: outraConta ? 70 : 50,
      ...(outraConta ? { transferAccountId: outraConta.id } : {}),
      motivo: outraConta
        ? `Parece transferência com ${outraConta.banco} · ${outraConta.nome_conta} — não é gasto nem renda`
        : "Parece transferência: confirme antes de lançar",
    };
  }

  return { matchStatus: "NEW", confidence: 0, motivo: "Sem correspondência no sistema" };
}
