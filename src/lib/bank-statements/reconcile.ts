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

/**
 * DATA É CRITÉRIO FORTE.
 *
 * Tolerância padrão de conciliação automática: a data contábil do extrato e a
 * data do registro no sistema não podem estar a mais de 2 dias de distância.
 * Semanas ou meses de diferença nunca podem virar MATCHED automático.
 */
export const TOLERANCIA_DIAS = 2;

/** Distância aceitável para associar automaticamente (exige data no extrato). */
const dentroDaJanela = (dataItem: string | null, dataRegistro: string, tol = TOLERANCIA_DIAS) =>
  !!dataItem && diasEntre(dataRegistro, dataItem) <= tol;

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
  //    Conta + sentido + valor são obrigatórios; a DATA decide se é MATCHED.
  const mesmoSentido = (t: (typeof contexto.transactions)[number]) =>
    (mov.valor < 0 && t.tipo !== "ENTRADA") || (mov.valor > 0 && t.tipo !== "SAIDA");
  const candidatosLedger = contexto.transactions.filter(
    (t) =>
      t.bank_account_id === contexto.accountId &&
      t.status !== "CANCELADA" &&
      perto(Number(t.valor), valor) &&
      mesmoSentido(t),
  );
  const jaNoLedger = candidatosLedger.find((t) => dentroDaJanela(data, t.data_movimento));
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
  // Mesmo valor, mas em outra data: NUNCA associa sozinho.
  const distanteNoLedger = candidatosLedger[0];

  // 1. Pagamento de fatura de cartão.
  const pareceCartao =
    texto.includes("cartao") || texto.includes("fatura") || texto.includes("card");
  if (mov.valor < 0 && pareceCartao) {
    const fatura = contexto.invoices.find(
      (f) =>
        perto(Number(f.valor_total), valor) &&
        !!data &&
        diasEntre(f.data_vencimento, data) <= 7,
    );
    if (fatura) {
      const paga = fatura.status === "PAGA";
      const noPrazo = dentroDaJanela(data, fatura.data_vencimento);
      return {
        matchStatus: paga && noPrazo ? "MATCHED" : "POSSIBLE_MATCH",
        reviewAction: paga && noPrazo ? "ASSOCIATE_EXISTING" : "MATCH_CARD_PAYMENT",
        confidence: paga && noPrazo ? 95 : 70,
        cardInvoiceId: fatura.id,
        motivo:
          paga && noPrazo
            ? "Pagamento desta fatura já registrado no sistema"
            : "Corresponde a uma fatura — confirme antes de associar (data fora da tolerância)",
        debug: {
          candidateInvoice: fatura.id,
          score: paga && noPrazo ? 95 : 70,
          decision: "CARD_PAYMENT_MATCH",
        },
      };
    }
  }

  // 2. Compra já lançada e paga por esta conta (a data precisa bater).
  const compra = contexto.purchases.find(
    (p) =>
      p.bank_account_id === contexto.accountId &&
      perto(Number(p.valor_total), valor) &&
      dentroDaJanela(data, p.data_pagamento_real ?? p.data_compra, 3),
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
      dentroDaJanela(data, t.data_movimento),
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

  // 4. Recebimento de uma receita cadastrada — só com data compatível.
  if (mov.valor > 0 && data) {
    const diaDoMes = new Date(`${data}T00:00:00`).getDate();
    const receita = contexto.incomes.find((r) => {
      if (!r.ativo) return false;
      if (!perto(Number(r.valor), valor)) return false;
      // Data é critério forte: sem dia de recebimento compatível, não associa.
      return r.dia_recebimento ? Math.abs(diaDoMes - r.dia_recebimento) <= 3 : false;
    });
    if (receita) {
      return {
        matchStatus: "POSSIBLE_MATCH",
        reviewAction: "MATCH_INCOME",
        confidence: 70,
        incomeId: receita.id,
        motivo: `Parece o recebimento da receita "${receita.descricao}" — confirme na revisão`,
        debug: { candidateIncome: receita.id, score: 70, decision: "INCOME_MATCH" },
      };
    }
  }

  // 4b. Mesmo valor e sentido, porém em data distante: nunca MATCHED automático.
  if (distanteNoLedger) {
    return {
      matchStatus: "POSSIBLE_MATCH",
      reviewAction: mov.valor < 0 ? "CREATE_PURCHASE" : "CREATE_TRANSACTION",
      confidence: 30,
      motivo: `Existe um lançamento igual em ${distanteNoLedger.data_movimento}, fora da tolerância de ${TOLERANCIA_DIAS} dias — não é o mesmo movimento`,
      debug: {
        candidateTransaction: distanteNoLedger.id,
        score: 30,
        decision: "CROSS_DATE_REJECTED",
        rejectionReason: "data fora da janela de conciliação",
      },
    };
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
