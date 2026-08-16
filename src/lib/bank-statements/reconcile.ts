/**
 * Conciliação do extrato com o que já existe no sistema.
 *
 * Regra central: se o lançamento do extrato já está representado no sistema
 * (compra no PIX/débito, pagamento de fatura, transferência entre contas da
 * própria família, recebimento de uma receita cadastrada), ele NÃO pode virar
 * uma nova movimentação — apenas se associa ao registro existente.
 *
 * Nada aqui persiste: a função devolve apenas sugestão + rastro de decisão.
 */
import { semAcento } from "@/lib/card-statement-parsers/generic";
import type { BankAccount } from "@/lib/bank-accounts";
import type { Purchase } from "@/lib/purchases";
import type { CardInvoice } from "@/lib/card-invoices";
import type { Transaction } from "@/lib/transactions";
import type { Income } from "@/lib/finance";
import type { BankStatementMatch, ParsedBankMovement, ReviewAction } from "./types";

export type ReconcileSuggestion = {
  matchStatus: BankStatementMatch;
  reviewAction: ReviewAction;
  confidence: number;
  purchaseId?: string;
  cardInvoiceId?: string;
  transferAccountId?: string;
  transactionId?: string;
  incomeId?: string;
  motivo: string;
  /** Rastro de decisão — usado no modo diagnóstico e no debug de match. */
  debug: {
    candidateTransaction?: string | undefined;
    candidatePurchase?: string | undefined;
    candidateIncome?: string | undefined;
    candidateInvoice?: string | undefined;
    score: number;
    decision: string;
    rejectionReason?: string | undefined;
  };
};

export type ReconcileContext = {
  accountId: string;
  purchases: Purchase[];
  invoices: CardInvoice[];
  accounts: BankAccount[];
  transactions: Transaction[];
  incomes: Income[];
};

const diasEntre = (a: string, b: string) =>
  Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime()) / 86_400_000;

const parecido = (a: string, b: string) => {
  const x = semAcento(a).toUpperCase();
  const y = semAcento(b).toUpperCase();
  if (!x || !y || y.length < 3) return false;
  return x.includes(y) || y.includes(x);
};

const perto = (a: number, b: number) => Math.abs(a - b) <= 0.02;

/** Sugere o estado de conciliação e a ação de revisão de um lançamento. */
export function reconcileMovement(
  mov: ParsedBankMovement,
  contexto: ReconcileContext,
): ReconcileSuggestion {
  const valor = Math.abs(mov.valor);
  const data = mov.data;
  const texto = semAcento(mov.descricaoOriginal).toLowerCase();

  // 0. O próprio ledger já tem esta movimentação nesta conta.
  const jaNoLedger = contexto.transactions.find(
    (t) =>
      t.bank_account_id === contexto.accountId &&
      t.status !== "CANCELADA" &&
      perto(Number(t.valor), valor) &&
      (!data || diasEntre(t.data_movimento, data) <= 2) &&
      ((mov.valor < 0 && t.tipo !== "ENTRADA") || (mov.valor > 0 && t.tipo !== "SAIDA")),
  );
  if (jaNoLedger) {
    return {
      matchStatus: "MATCHED",
      reviewAction: "ASSOCIATE_EXISTING",
      confidence: 92,
      transactionId: jaNoLedger.id,
      motivo: `Já lançado: ${jaNoLedger.descricao}`,
      debug: { candidateTransaction: jaNoLedger.id, score: 92, decision: "MATCHED no ledger" },
    };
  }

  // 1. Pagamento de fatura de cartão.
  const pareceCartao =
    texto.includes("cartao") || texto.includes("fatura") || texto.includes("card");
  if (mov.valor < 0 && pareceCartao) {
    const fatura = contexto.invoices.find(
      (f) => perto(Number(f.valor_total), valor) && (!data || diasEntre(f.data_vencimento, data) <= 7),
    );
    if (fatura) {
      const paga = fatura.status === "PAGA";
      return {
        matchStatus: paga ? "MATCHED" : "POSSIBLE_MATCH",
        reviewAction: paga ? "ASSOCIATE_EXISTING" : "MATCH_CARD_PAYMENT",
        confidence: paga ? 95 : 82,
        cardInvoiceId: fatura.id,
        motivo: paga
          ? "Pagamento desta fatura já registrado no sistema"
          : "Corresponde a uma fatura em aberto — será associado ao pagamento da fatura",
        debug: {
          candidateInvoice: fatura.id,
          score: paga ? 95 : 82,
          decision: "CARD_PAYMENT_MATCH",
        },
      };
    }
  }

  // 2. Compra já lançada e paga por esta conta.
  const compra = contexto.purchases.find(
    (p) =>
      p.bank_account_id === contexto.accountId &&
      perto(Number(p.valor_total), valor) &&
      (!data || diasEntre(p.data_pagamento_real ?? p.data_compra, data) <= 3),
  );
  if (compra && mov.valor < 0) {
    const forte = parecido(mov.descricaoOriginal, compra.estabelecimento);
    return {
      matchStatus: forte ? "MATCHED" : "POSSIBLE_MATCH",
      reviewAction: "ASSOCIATE_EXISTING",
      confidence: forte ? 95 : 80,
      purchaseId: compra.id,
      motivo: `Compra já cadastrada: ${compra.estabelecimento}`,
      debug: {
        candidatePurchase: compra.id,
        score: forte ? 95 : 80,
        decision: "PURCHASE_MATCH",
      },
    };
  }

  // 3. Transferência entre contas da própria família.
  const outraConta = contexto.accounts.find(
    (a) =>
      a.id !== contexto.accountId &&
      (parecido(mov.descricaoOriginal, a.banco) || parecido(mov.descricaoOriginal, a.nome_conta)),
  );
  const contraparte = contexto.transactions.find(
    (t) =>
      t.bank_account_id &&
      t.bank_account_id !== contexto.accountId &&
      perto(Number(t.valor), valor) &&
      (!data || diasEntre(t.data_movimento, data) <= 2),
  );
  if (outraConta || contraparte || mov.tipo === "TRANSFERENCIA") {
    const destino = outraConta?.id ?? contraparte?.bank_account_id ?? undefined;
    const score = destino ? 75 : 50;
    return {
      matchStatus: "POSSIBLE_MATCH",
      reviewAction: destino ? "MATCH_TRANSFER" : "CREATE_TRANSACTION",
      confidence: score,
      ...(destino ? { transferAccountId: destino } : {}),
      motivo: destino
        ? "Parece transferência entre contas da família — patrimônio, não gasto nem renda"
        : "Parece transferência: escolha a conta de contrapartida ou registre como movimentação",
      debug: { score, decision: "TRANSFER_MATCH", candidateTransaction: contraparte?.id },
    };
  }

  // 4. Recebimento de uma receita cadastrada.
  if (mov.valor > 0) {
    const receita = contexto.incomes.find((r) => {
      if (!r.ativo) return false;
      const mesmoValor = perto(Number(r.valor), valor);
      const mesmoDia = data && r.dia_recebimento
        ? Math.abs(Number(new Date(`${data}T00:00:00`).getDate()) - r.dia_recebimento) <= 3
        : false;
      return mesmoValor || (mesmoDia && parecido(mov.descricaoOriginal, r.descricao));
    });
    if (receita) {
      const forte = perto(Number(receita.valor), valor);
      return {
        matchStatus: forte ? "MATCHED" : "POSSIBLE_MATCH",
        reviewAction: "MATCH_INCOME",
        confidence: forte ? 88 : 60,
        incomeId: receita.id,
        motivo: `Recebimento da receita "${receita.descricao}" — não cria outra receita fixa`,
        debug: { candidateIncome: receita.id, score: forte ? 88 : 60, decision: "INCOME_MATCH" },
      };
    }
  }

  // 5. Tarifas, juros e estornos.
  if (mov.tipo === "TARIFA" || mov.tipo === "JUROS") {
    return {
      matchStatus: "NEW",
      reviewAction: "REGISTER_FEE",
      confidence: 70,
      motivo: "Tarifa/encargo do banco — saída válida, mas não é consumo",
      debug: { score: 70, decision: "FEE" },
    };
  }
  if (mov.tipo === "ESTORNO") {
    const original = contexto.purchases.find(
      (p) => perto(Number(p.valor_total), valor) && parecido(mov.descricaoOriginal, p.estabelecimento),
    );
    return {
      matchStatus: "NEW",
      reviewAction: "REGISTER_REFUND",
      confidence: original ? 70 : 50,
      ...(original ? { purchaseId: original.id } : {}),
      motivo: original
        ? `Estorno relacionado à compra ${original.estabelecimento}`
        : "Estorno/devolução — entra como crédito na conta",
      debug: { candidatePurchase: original?.id, score: original ? 70 : 50, decision: "REFUND" },
    };
  }

  return {
    matchStatus: "NEW",
    reviewAction: mov.valor < 0 ? "CREATE_PURCHASE" : "CREATE_TRANSACTION",
    confidence: 0,
    motivo: "Sem correspondência no sistema",
    debug: { score: 0, decision: "NEW", rejectionReason: "nenhum candidato compatível" },
  };
}
