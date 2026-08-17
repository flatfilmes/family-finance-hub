/**
 * FASE 3F — MUNDO ECONÔMICO DE TESTE (fixture isolada).
 *
 * Nada aqui reimplementa regra financeira: são apenas fábricas de dados e um
 * executor em memória que espelha os EFEITOS das operações canônicas
 * (create_purchase_complete, register_bank_movement, vínculo de evidência).
 * Toda a matemática continua vindo dos motores reais do projeto.
 */
import type { CardInvoice, ExpenseInstallment } from "@/lib/card-invoices";
import type { FixedExpense, Income } from "@/lib/finance";
import type { Purchase } from "@/lib/purchases";
import type { RecurringExpense } from "@/lib/recurring-expenses";
import type { Transaction } from "@/lib/transactions";
import type {
  ConfirmDeps,
  ConfirmationStatus,
  PersistedItemState,
} from "@/lib/financial-evidence/confirm";
import type { ConfirmationPlan, ReviewContext } from "@/lib/financial-evidence/plan";
import type {
  CoveredPeriod,
  EvidenceSourceType,
  FinancialCandidateEvent,
} from "@/lib/financial-evidence/types";
import { SOURCE_CONFIDENCE } from "@/lib/financial-evidence/types";

export const FAMILY_A = "fam-a";
export const FAMILY_B = "fam-b";
export const MEMBER_A = "member-a";
export const ACCOUNT_A = "acc-a";
export const ACCOUNT_B = "acc-b";
export const CARD_A = "card-a";

let seq = 0;
const nextId = (prefixo: string) => `${prefixo}-${++seq}`;

/* -------------------------------------------------------------------------- */
/* Fábricas de linhas do domínio                                              */
/* -------------------------------------------------------------------------- */

export function purchase(over: Partial<Purchase> = {}): Purchase {
  return {
    id: nextId("pur"),
    family_id: FAMILY_A,
    member_id: MEMBER_A,
    estabelecimento: "Mercado XYZ",
    data_compra: "2026-08-12",
    valor_total: 84.9,
    forma_pagamento: "CREDITO",
    tipo_compra: "COMPRA_NORMAL",
    status_pagamento: "COMPROMETIDO",
    credit_card_id: CARD_A,
    bank_account_id: null,
    data_pagamento_real: null,
    data_prevista_pagamento: null,
    observacao: null,
    created_at: "2026-08-12T12:00:00Z",
    updated_at: "2026-08-12T12:00:00Z",
    ...over,
  } as unknown as Purchase;
}

export function transaction(over: Partial<Transaction> = {}): Transaction {
  return {
    id: nextId("tx"),
    family_id: FAMILY_A,
    member_id: MEMBER_A,
    bank_account_id: ACCOUNT_A,
    tipo: "SAIDA",
    status: "CONFIRMADA",
    valor: 100,
    data_movimento: "2026-08-05",
    descricao: "Movimento",
    transfer_group_id: null,
    credit_card_id: null,
    card_invoice_id: null,
    purchase_id: null,
    ...over,
  } as unknown as Transaction;
}

export function invoice(over: Partial<CardInvoice> = {}): CardInvoice {
  return {
    id: nextId("inv"),
    family_id: FAMILY_A,
    credit_card_id: CARD_A,
    data_fechamento: "2026-08-28",
    data_vencimento: "2026-09-05",
    valor_total: 500,
    status: "FECHADA",
    ...over,
  } as unknown as CardInvoice;
}

export function installment(over: Partial<ExpenseInstallment> = {}): ExpenseInstallment {
  return {
    id: nextId("par"),
    family_id: FAMILY_A,
    member_id: MEMBER_A,
    purchase_id: null,
    expense_id: null,
    card_invoice_id: null,
    numero_parcela: 1,
    total_parcelas: 12,
    valor_parcela: 100,
    data_vencimento: "2026-08-10",
    status: "PENDENTE",
    ...over,
  } as unknown as ExpenseInstallment;
}

export function income(over: Partial<Income> = {}): Income {
  return {
    id: nextId("inc"),
    family_id: FAMILY_A,
    member_id: MEMBER_A,
    descricao: "Salário",
    tipo: "FIXA",
    frequencia: "MENSAL",
    valor: 5000,
    dia_recebimento: 5,
    ativo: true,
    ...over,
  } as unknown as Income;
}

export function fixedExpense(over: Partial<FixedExpense> = {}): FixedExpense {
  return {
    id: nextId("fix"),
    family_id: FAMILY_A,
    member_id: MEMBER_A,
    descricao: "Energia",
    valor: 200,
    vencimento: 10,
    recorrencia: "MENSAL",
    categoria: "MORADIA",
    ativo: true,
    ...over,
  } as unknown as FixedExpense;
}

export function recurring(over: Partial<RecurringExpense> = {}): RecurringExpense {
  return {
    id: nextId("rec"),
    family_id: FAMILY_A,
    member_id: MEMBER_A,
    descricao: "Serviço Teste",
    valor: 50,
    periodicidade: "MENSAL",
    data_inicio: "2026-08-01",
    proxima_cobranca: "2026-08-15",
    data_cancelamento: null,
    credit_card_id: null,
    bank_account_id: null,
    ativo: true,
    ...over,
  } as unknown as RecurringExpense;
}

/* -------------------------------------------------------------------------- */
/* Candidatos de evidência                                                    */
/* -------------------------------------------------------------------------- */

export function candidate(over: Partial<FinancialCandidateEvent> = {}): FinancialCandidateEvent {
  const sourceType: EvidenceSourceType = over.sourceType ?? "CARD_SCREENSHOT";
  return {
    evidenceId: "ev-1",
    sourceType,
    sourceItemKey: "ev-1#001",
    ordem: 1,
    eventDate: "2026-08-12",
    postingDate: "2026-08-12",
    description: "MERCADO XYZ",
    amount: 84.9,
    rawAmount: 84.9,
    direction: "OUT",
    economicKind: "PURCHASE",
    cardLast4: "9982",
    installmentCurrent: null,
    installmentTotal: null,
    bankAccountId: null,
    creditCardId: CARD_A,
    institutionId: "inst-nubank",
    extractionConfidence: 0.95,
    sourceConfidence: SOURCE_CONFIDENCE[sourceType],
    rawText: null,
    ...over,
    ...(over.sourceType ? { sourceConfidence: over.sourceConfidence ?? SOURCE_CONFIDENCE[over.sourceType] } : {}),
  };
}

export function reviewContext(over: Partial<ReviewContext> = {}): ReviewContext {
  return {
    familyId: FAMILY_A,
    evidenceImportId: "ev-1",
    sourceType: "CARD_SCREENSHOT",
    bankAccountId: null,
    creditCardId: CARD_A,
    memberId: MEMBER_A,
    contextLabel: "Roxinho Teste",
    ...over,
  };
}

export function coveredPeriod(over: Partial<CoveredPeriod> = {}): CoveredPeriod {
  return {
    evidenceId: "ev-anterior",
    inicio: "2026-08-01",
    fim: "2026-08-17",
    rotulo: "Extrato A",
    ...over,
  };
}

/* -------------------------------------------------------------------------- */
/* Executor em memória (espelha os efeitos das RPCs canônicas)                */
/* -------------------------------------------------------------------------- */

export type WorldState = {
  purchases: Purchase[];
  transactions: Transaction[];
  links: Array<{ purchaseId: string | null; evidenceItemKey: string }>;
  reviews: Array<{ candidateKey: string; status: ConfirmationStatus; confirmationId: string }>;
  itens: Record<string, PersistedItemState>;
};

export type World = {
  state: WorldState;
  deps: ConfirmDeps;
  chamadas: { createPurchase: number; movement: number; link: number; log: number };
  /** Simula perda da resposta HTTP DEPOIS do commit (retry/timeout). */
  perderRespostaUmaVez: () => void;
  netWorth: () => number;
  economicEventCount: () => number;
};

export function createWorld(inicial: Partial<WorldState> = {}): World {
  const state: WorldState = {
    purchases: inicial.purchases ?? [],
    transactions: inicial.transactions ?? [],
    links: inicial.links ?? [],
    reviews: inicial.reviews ?? [],
    itens: inicial.itens ?? {},
  };
  const chamadas = { createPurchase: 0, movement: 0, link: 0, log: 0 };
  let perderResposta = false;

  const efeitoBancario = (plan: ConfirmationPlan) => {
    // Compra no cartão NÃO movimenta banco; Pix/débito/dinheiro movimentam.
    return plan.formaPagamento === "CREDITO" || plan.formaPagamento === "BOLETO" ? null : plan.accountId;
  };

  const deps: ConfirmDeps = {
    readItemState: async (candidateKey) => state.itens[candidateKey] ?? null,
    createPurchase: async ({ plan }) => {
      chamadas.createPurchase += 1;
      const nova = purchase({
        id: nextId("pur"),
        family_id: FAMILY_A,
        member_id: plan.memberId,
        estabelecimento: plan.candidate.description,
        data_compra: plan.candidate.eventDate ?? plan.candidate.postingDate ?? "2026-08-01",
        valor_total: plan.economicAmount,
        forma_pagamento: plan.formaPagamento ?? "CREDITO",
        credit_card_id: plan.formaPagamento === "CREDITO" ? plan.cardId : null,
        bank_account_id: efeitoBancario(plan),
        status_pagamento: plan.formaPagamento === "CREDITO" ? "COMPROMETIDO" : "PAGO",
      });
      state.purchases.push(nova);
      const conta = efeitoBancario(plan);
      if (conta) {
        state.transactions.push(
          transaction({
            bank_account_id: conta,
            tipo: "SAIDA",
            valor: plan.economicAmount,
            data_movimento: nova.data_compra,
            descricao: nova.estabelecimento,
            purchase_id: nova.id,
          }),
        );
      }
      if (perderResposta) {
        perderResposta = false;
        throw new Error("NETWORK_TIMEOUT_AFTER_COMMIT");
      }
      return { id: nova.id };
    },
    registerBankMovement: async ({ plan }) => {
      chamadas.movement += 1;
      const tx = transaction({
        bank_account_id: plan.accountId ?? ACCOUNT_A,
        tipo: plan.candidate.direction === "IN" ? "ENTRADA" : "SAIDA",
        valor: plan.economicAmount,
        data_movimento: plan.candidate.eventDate ?? plan.candidate.postingDate ?? "2026-08-01",
        descricao: plan.candidate.description,
      });
      state.transactions.push(tx);
      return tx.id;
    },
    linkEvidence: async ({ plan }) => {
      chamadas.link += 1;
      state.links.push({
        purchaseId: plan.matched?.kind === "PURCHASE" ? plan.matched.id : null,
        evidenceItemKey: plan.candidateKey,
      });
    },
    markItem: async ({ candidateKey, status, purchaseId, transactionId }) => {
      state.itens[candidateKey] = {
        itemId: candidateKey,
        confirmationStatus: status,
        createdPurchaseId: purchaseId ?? state.itens[candidateKey]?.createdPurchaseId ?? null,
        createdTransactionId: transactionId ?? state.itens[candidateKey]?.createdTransactionId ?? null,
      };
    },
    logReview: async ({ confirmationId, outcome }) => {
      chamadas.log += 1;
      state.reviews.push({
        candidateKey: outcome.candidateKey,
        status: outcome.status,
        confirmationId,
      });
    },
  };

  return {
    state,
    deps,
    chamadas,
    perderRespostaUmaVez: () => {
      perderResposta = true;
    },
    netWorth: () =>
      Math.round(
        state.transactions
          .filter((t) => t.status !== "CANCELADA")
          .reduce((acc, t) => acc + (t.tipo === "ENTRADA" ? 1 : -1) * (Number(t.valor) || 0), 0) * 100,
      ) / 100,
    economicEventCount: () => state.purchases.length + state.transactions.length,
  };
}

/** Simula o commit já persistido antes do retry (resposta HTTP perdida). */
export function marcarConfirmado(world: World, candidateKey: string, purchaseId: string) {
  world.state.itens[candidateKey] = {
    itemId: candidateKey,
    confirmationStatus: "CONFIRMED",
    createdPurchaseId: purchaseId,
    createdTransactionId: null,
  };
}
