/**
 * Dependências reais do executor de confirmação (Fase 3E).
 *
 * O executor (confirm.ts) é puro e testável; aqui ficam as chamadas às
 * operações CANÔNICAS já existentes:
 * - compras   → RPC create_purchase_complete (atômica e idempotente);
 * - dinheiro  → RPC register_bank_movement (valida família/conta no servidor);
 * - evidência → purchase_evidence_links.
 *
 * Toda autorização é revalidada no servidor: as RPCs e as políticas RLS
 * conferem auth.uid(), família, membro e propriedade da conta/cartão. O que
 * veio da tela nunca é tratado como verdade.
 */
import { supabase } from "@/integrations/supabase/client";
import { createPurchase } from "@/lib/purchases";
import { registerBankMovement } from "@/lib/bank-movements";
import type { ConfirmDeps } from "./confirm";
import type { ConfirmationPlan } from "./plan";

const dataDoCandidato = (p: ConfirmationPlan) =>
  p.candidate.eventDate ?? p.candidate.postingDate ?? new Date().toISOString().slice(0, 10);

export function createConfirmDeps(): ConfirmDeps {
  return {
    async readItemState(candidateKey) {
      const { data, error } = await supabase
        .from("financial_evidence_items")
        .select("id, confirmation_status, created_purchase_id, created_transaction_id")
        .eq("source_item_key", candidateKey)
        .maybeSingle();
      if (error) throw error;
      if (!data) return null;
      return {
        itemId: data.id,
        confirmationStatus: data.confirmation_status ?? "PENDING",
        createdPurchaseId: data.created_purchase_id,
        createdTransactionId: data.created_transaction_id,
      };
    },

    async createPurchase({ plan, context, confirmationId }) {
      const forma = plan.formaPagamento ?? "OUTRO";
      const purchase = await createPurchase({
        purchase: {
          family_id: context.familyId,
          member_id: plan.memberId,
          estabelecimento: plan.candidate.description.trim(),
          data_compra: dataDoCandidato(plan),
          tipo_compra: plan.candidate.installmentTotal && plan.candidate.installmentTotal > 1
            ? "COMPRA_PARCELADA"
            : "COMPRA_NORMAL",
          forma_pagamento: forma,
          credit_card_id: forma === "CREDITO" ? plan.cardId : null,
          bank_account_id: forma === "CREDITO" ? null : plan.accountId,
          observacao: `Origem: evidência ${context.sourceType}`,
        },
        items: [],
        ...(plan.candidate.installmentTotal ? { parcelas: plan.candidate.installmentTotal } : {}),
        ...(plan.candidate.installmentCurrent ? { parcelaInicial: plan.candidate.installmentCurrent } : {}),
        clientRequestId: confirmationId,
      });
      return { id: purchase.id };
    },

    async registerBankMovement({ plan }) {
      if (!plan.accountId) throw new Error("Conta bancária ausente.");
      return registerBankMovement({
        accountId: plan.accountId,
        direcao: plan.candidate.direction === "IN" ? "ENTRADA" : "SAIDA",
        valor: plan.economicAmount,
        data: dataDoCandidato(plan),
        descricao: plan.candidate.description,
        natureza:
          plan.candidate.economicKind === "INCOME"
            ? "RECEITA"
            : plan.candidate.economicKind === "REFUND"
              ? "ESTORNO"
              : "OUTRO",
      });
    },

    async linkEvidence({ plan, context, itemId }) {
      if (plan.matched?.kind !== "PURCHASE") return;
      const { error } = await supabase.from("purchase_evidence_links").insert({
        family_id: context.familyId,
        purchase_id: plan.matched.id,
        source_type: context.sourceType,
        evidence_item_id: itemId,
        observacao: `Vínculo de evidência (${plan.originalStatus})`,
      });
      // Vínculo repetido não é erro: a evidência já está provando a compra.
      if (error && !/duplicate|unique/i.test(error.message)) throw error;
    },

    async markItem({ candidateKey, status, confirmationId, purchaseId, transactionId, plan }) {
      const { error } = await supabase
        .from("financial_evidence_items")
        .update({
          confirmation_status: status,
          confirmation_id: confirmationId,
          created_purchase_id: purchaseId ?? null,
          created_transaction_id: transactionId ?? null,
          review_action: plan.action,
          override_of_status: plan.overrideOfStatus,
          reviewed_at: new Date().toISOString(),
          confirmed_at: new Date().toISOString(),
        })
        .eq("source_item_key", candidateKey);
      if (error) throw error;
    },

    async logReview({ plan, context, confirmationId, outcome }) {
      const { data: sessao } = await supabase.auth.getUser();
      const { error } = await supabase.from("financial_evidence_reviews").insert({
        family_id: context.familyId,
        evidence_import_id: context.evidenceImportId,
        candidate_key: plan.candidateKey,
        source_type: context.sourceType,
        original_status: plan.originalStatus,
        action: plan.action,
        matched_entity_kind: plan.matched?.kind ?? null,
        matched_entity_id: plan.matched?.id ?? null,
        created_entity_kind: outcome.purchaseId ? "PURCHASE" : outcome.transactionId ? "TRANSACTION" : null,
        created_entity_id: outcome.purchaseId ?? outcome.transactionId ?? null,
        confirmation_id: confirmationId,
        reviewed_by: sessao.user?.id ?? "",
      });
      if (error && !/duplicate|unique/i.test(error.message)) throw error;
    },
  };
}
