import { useMemo } from "react";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useCardInvoices, useCardOverview, useInstallments } from "@/hooks/useCardInvoices";
import { usePurchases } from "@/hooks/usePurchases";
import { useExpenses } from "@/hooks/useExpenses";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";
import { useConfirmedInstallmentItems, useStatementImports } from "@/hooks/useCardStatements";
import {
  mesclarParcelasProjetadas,
  projetarParcelasDoCiclo,
} from "@/lib/card-installment-projection";

import {
  agruparCiclos,
  buildCardCycleComposition,
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

  /**
   * Projeção das parcelas já contratadas para um ciclo ainda sem fatura oficial.
   *
   * A parcela atual de cada série vem da última fatura CONFIRMADA do cartão (o
   * PDF é evidência explícita). O cronograma interno pode estar ancorado em
   * datas históricas, então ele não pode ser a única fonte das próximas.
   */
  const projecaoParcelasDe = (
    cardId: string,
    ciclo: Parameters<typeof buildCardCycleComposition>[0]["ciclo"],
  ) => {
    if (!ciclo || ciclo.fonte === "OFFICIAL_STATEMENT") return [];
    const doCartao = (itensParcelados.data ?? []).filter((i) => i.credit_card_id === cardId);
    if (doCartao.length === 0) return [];
    const vencimentoBase = doCartao
      .map((i) => i.card_statement_imports?.data_vencimento ?? null)
      .filter((v): v is string => !!v)
      .sort()
      .at(-1);
    if (!vencimentoBase) return [];
    const itens = doCartao.filter(
      (i) => i.card_statement_imports?.data_vencimento === vencimentoBase,
    );
    const mesesEntre = (a: string, b: string) =>
      (Number(b.slice(0, 4)) - Number(a.slice(0, 4))) * 12 +
      (Number(b.slice(5, 7)) - Number(a.slice(5, 7)));
    return projetarParcelasDoCiclo({
      itens,
      offset: mesesEntre(vencimentoBase, ciclo.invoice.data_vencimento),
      vencimentoCiclo: ciclo.invoice.data_vencimento,
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
          card: (cards.data ?? []).find((c) => c.id === cardId) ?? null,
          recorrencias: recorrenciasDoCartao(cardId),
          parcelas: parcelasDoCartao(cardId),
        }),
      ),
    /** Parcelas já contratadas projetadas no ciclo, a partir da fatura oficial. */
    projecaoParcelasDe,
    /**
     * Composição do ciclo — função única usada pela régua, pelo resumo, pelos
     * lançamentos, pelos compromissos futuros e pelo planejamento.
     */
    composicaoCicloDe: (
      cardId: string,
      ciclo: Parameters<typeof buildCardCycleComposition>[0]["ciclo"],
      itensOficiais?: Parameters<typeof buildCardCycleComposition>[0]["itensOficiais"],
    ) =>
      buildCardCycleComposition({
        ciclo,
        itensOficiais: itensOficiais ?? null,
        linhasInternas: mesclarParcelasProjetadas(
          linhasDaFatura({
            invoice: (ciclo?.invoice as CardInvoice | undefined) ?? null,
            parcelas: parcelas.data ?? [],
            comprasDoCartao: comprasDoCartao(cardId),
            comprasComParcelas,
            despesaPorId,
            compraPorId,
            card: (cards.data ?? []).find((c) => c.id === cardId) ?? null,
          }).map((l) => ({ ...l, itemId: l.id })),
          projecaoParcelasDe(cardId, ciclo),
        ),
        compraPorId,
      }),

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
    composicaoDe: (cardId: string) => {
      const obrigacao = obrigacaoAbertaDe(cardId);
      return composicaoUtilizado({
        utilizadoParcelas: info(cardId)?.utilizado ?? 0,
        faturaAtual: info(cardId)?.valorFaturaAtual ?? 0,
        faturaOficial: obrigacao.oficial ? obrigacao.valor : null,
        parcelasFuturas: info(cardId)?.parcelasFuturas ?? 0,
        comprasSemParcela: comprasSemParcelaDe(cardId),
      });
    },
    utilizadoDe: (cardId: string) => {
      const obrigacao = obrigacaoAbertaDe(cardId);
      const base = utilizadoDoCartao({
        utilizadoParcelas: info(cardId)?.utilizado ?? 0,
        comprasDoCartao: comprasDoCartao(cardId),
        comprasComParcelas,
      });
      // Documento oficial substitui a estimativa do ciclo (sem somar as duas).
      const ajuste = obrigacao.oficial
        ? obrigacao.valor - (info(cardId)?.valorFaturaAtual ?? 0)
        : 0;
      return Math.round((base + ajuste) * 100) / 100;
    },
    linhasDe: (cardId: string, invoice: CardInvoice | null) =>
      linhasDaFatura({
        invoice,
        parcelas: parcelas.data ?? [],
        comprasDoCartao: comprasDoCartao(cardId),
        comprasComParcelas,
        despesaPorId,
        compraPorId,
        card: (cards.data ?? []).find((c) => c.id === cardId) ?? null,
      }),
    proximasDe: (cardId: string) =>
      proximasObrigacoes({
        card: (cards.data ?? []).find((c) => c.id === cardId) ?? {
          dia_fechamento: 1,
          dia_vencimento: 10,
        },
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
