import { useMemo } from "react";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useCardInvoices, useCardOverview, useInstallments } from "@/hooks/useCardInvoices";
import { usePurchases } from "@/hooks/usePurchases";
import { useExpenses } from "@/hooks/useExpenses";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { useStatementImports } from "@/hooks/useCardStatements";
import {
  agruparCiclos,
  classificarCiclosDoCartao,
  composicaoUtilizado,
  faturaDoCiclo,
  linhasDaFatura,
  obrigacaoAbertaDoCartao,
  parcelamentosAtivos,
  proximasObrigacoes,
  utilizadoDoCartao,
} from "@/lib/card-details";
import type { CardInvoice } from "@/lib/card-invoices";
import type { Expense } from "@/lib/expenses";
import type { Purchase } from "@/lib/purchases";


/**
 * Dados de crédito compartilhados entre a lista de cartões e a página de detalhe.
 * Os cálculos são exatamente os mesmos em qualquer tela — só a apresentação muda.
 */
export function useCardsData(familyId?: string) {
  const cards = useCreditCards(familyId);
  const overview = useCardOverview(familyId, cards.data ?? []);
  const purchases = usePurchases(familyId);
  const despesas = useExpenses(familyId);
  const faturas = useCardInvoices(familyId);
  const parcelas = useInstallments(familyId);
  const recorrentes = useRecurringExpenses(familyId);
  const importacoes = useStatementImports(familyId);


  const despesaPorId = useMemo(() => {
    const m = new Map<string, Expense>();
    for (const e of despesas.data ?? []) m.set(e.id, e);
    return m;
  }, [despesas.data]);

  const compraPorId = useMemo(() => {
    const m = new Map<string, Purchase>();
    for (const p of purchases.data ?? []) m.set(p.id, p);
    return m;
  }, [purchases.data]);

  /**
   * Compras que já viraram parcelas na fatura — não podem ser somadas de novo.
   * A ligação oficial é expense_installments.purchase_id; a despesa legada é fallback.
   */
  const comprasComParcelas = useMemo(() => {
    const ids = new Set<string>();
    for (const p of parcelas.data ?? []) if (p.purchase_id) ids.add(p.purchase_id);
    for (const e of despesas.data ?? []) if (e.purchase_id) ids.add(e.purchase_id);
    return ids;
  }, [parcelas.data, despesas.data]);

  const info = (cardId: string) => overview.porCartao.find((o) => o.card.id === cardId);
  const comprasDoCartao = (cardId: string) =>
    (purchases.data ?? []).filter((p) => p.credit_card_id === cardId);
  const faturasDoCartao = (cardId: string) =>
    (faturas.data ?? []).filter((i) => i.credit_card_id === cardId);
  const recorrenciasDoCartao = (cardId: string) =>
    (recorrentes.data ?? []).filter((r) => r.credit_card_id === cardId);
  const parcelasDoCartao = (cardId: string) => {
    const ids = new Set(faturasDoCartao(cardId).map((i) => i.id));
    return (parcelas.data ?? []).filter((p) => p.card_invoice_id && ids.has(p.card_invoice_id));
  };

  const comprasSemParcelaDe = (cardId: string) =>
    comprasDoCartao(cardId)
      .filter((p) => p.status_pagamento === "COMPROMETIDO" && !comprasComParcelas.has(p.id))
      .reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);

  const obrigacaoAbertaDe = (cardId: string) => {
    const invoice = info(cardId)?.faturaAtual ?? null;
    return obrigacaoAbertaDoCartao({
      cardId,
      invoice,
      imports: importacoes.data ?? [],
    });
  };

  return {
    isLoading: cards.isLoading,
    cards: cards.data ?? [],
    info,
    faturasDoCartao,
    /** Ciclos classificados: reais, em formação e projeções (nunca "aberta" para tudo). */
    ciclosDe: (cardId: string) =>
      agruparCiclos(
        classificarCiclosDoCartao({
          invoices: faturasDoCartao(cardId),
          imports: importacoes.data ?? [],
        }),
      ),
    recorrenciasDoCartao,
    parcelasDoCartao,
    /**
     * Fatura do ciclo: usa a fatura importada CONFIRMADA do mesmo ciclo como
     * fonte oficial; sem documento oficial, devolve a estimativa interna.
     */
    faturaDe: (cardId: string, invoice: CardInvoice | null) =>
      faturaDoCiclo({ cardId, invoice, imports: importacoes.data ?? [] }),
    /** Uma obrigação aberta por cartão, oficial quando houver importação confirmada. */
    obrigacaoAbertaDe,
    /** Composição auditável do limite utilizado. */
    composicaoDe: (cardId: string) =>
      composicaoUtilizado({
        utilizadoParcelas: info(cardId)?.utilizado ?? 0,
        faturaAtual: info(cardId)?.valorFaturaAtual ?? 0,
        parcelasFuturas: info(cardId)?.parcelasFuturas ?? 0,
        comprasSemParcela: comprasSemParcelaDe(cardId),
      }),
    utilizadoDe: (cardId: string) =>
      utilizadoDoCartao({
        utilizadoParcelas: info(cardId)?.utilizado ?? 0,
        comprasDoCartao: comprasDoCartao(cardId),
        comprasComParcelas,

      }),
    linhasDe: (cardId: string, invoice: CardInvoice | null) =>
      linhasDaFatura({
        invoice,
        parcelas: parcelas.data ?? [],
        comprasDoCartao: comprasDoCartao(cardId),
        comprasComParcelas,
        despesaPorId,
        compraPorId,
      }),
    proximasDe: (cardId: string) =>
      proximasObrigacoes({
        parcelas: parcelas.data ?? [],
        faturas: faturasDoCartao(cardId),
        recorrencias: recorrenciasDoCartao(cardId),
      }),
    parcelamentosDe: (cardId: string) =>
      parcelamentosAtivos({
        parcelas: parcelas.data ?? [],
        faturas: faturasDoCartao(cardId),
        despesaPorId,
        compraPorId,
      }),
  };
}
