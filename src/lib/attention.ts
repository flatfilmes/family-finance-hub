/**
 * Central "Precisa da sua atenção".
 *
 * Só reúne pendências que já existem em outras áreas do sistema — não cria
 * nenhum cálculo financeiro novo, nem altera saldos, faturas ou compromissos.
 * Todas as regras são determinísticas (datas e status), sem IA.
 */

import type { Tone } from "@/lib/status";
import type { Purchase } from "@/lib/purchases";
import type { CardInvoice } from "@/lib/card-invoices";
import type { FixedExpense } from "@/lib/finance";
import type { RecurringExpense } from "@/lib/recurring-expenses";

export type Prioridade = "ALTA" | "MEDIA" | "BAIXA";

export type AttentionItem = {
  id: string;
  prioridade: Prioridade;
  titulo: string;
  detalhe: string;
  valor?: number;
  /** Ação sugerida: rota existente ou ação local (registrar pagamento). */
  acao: {
    label: string;
    to?: string;
    params?: Record<string, string>;
    purchaseId?: string;
  };
};

export const PRIORIDADE_TONE: Record<Prioridade, Tone> = {
  ALTA: "danger",
  MEDIA: "warn",
  BAIXA: "info",
};

export const PRIORIDADE_LABEL: Record<Prioridade, string> = {
  ALTA: "Urgente",
  MEDIA: "Em breve",
  BAIXA: "Quando puder",
};

const ORDEM: Record<Prioridade, number> = { ALTA: 0, MEDIA: 1, BAIXA: 2 };

function toDate(iso: string) {
  const [y, m, d] = iso.slice(0, 10).split("-").map(Number);
  return new Date(y!, (m ?? 1) - 1, d ?? 1);
}

/** Dias entre hoje e a data (negativo = atrasado). */
export function diasAte(iso: string, hoje = new Date()) {
  const base = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
  return Math.round((toDate(iso).getTime() - base.getTime()) / 86_400_000);
}

function prazoTexto(dias: number) {
  if (dias < 0) return `atrasado há ${Math.abs(dias)} ${Math.abs(dias) === 1 ? "dia" : "dias"}`;
  if (dias === 0) return "vence hoje";
  if (dias === 1) return "vence amanhã";
  return `vence em ${dias} dias`;
}

/** Atrasado = ALTA; até 2 dias = ALTA; até 7 dias = MÉDIA; acima disso não entra. */
function prioridadePorPrazo(dias: number): Prioridade | null {
  if (dias < 0 || dias <= 2) return "ALTA";
  if (dias <= 7) return "MEDIA";
  return null;
}

/** Data do vencimento de uma conta recorrente (dia fixo) no mês corrente ou seguinte. */
function proximoVencimentoDoDia(dia: number, hoje = new Date()) {
  const ano = hoje.getFullYear();
  const mes = hoje.getMonth();
  const ultimoDia = new Date(ano, mes + 1, 0).getDate();
  const candidato = new Date(ano, mes, Math.min(dia, ultimoDia));
  if (candidato.getTime() >= new Date(ano, mes, hoje.getDate()).getTime()) return candidato;
  const proxUltimo = new Date(ano, mes + 2, 0).getDate();
  return new Date(ano, mes + 1, Math.min(dia, proxUltimo));
}

function iso(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

export type AttentionInput = {
  purchases: Purchase[];
  invoices: CardInvoice[];
  cardName: (cardId: string) => string;
  fixedExpenses: FixedExpense[];
  recurring: RecurringExpense[];
  /** Quantidade de itens de compra ainda sem categoria. */
  itensSemCategoria: number;
  /** Documentos enviados aguardando revisão. */
  documentosPendentes: number;
  hoje?: Date;
};

export function buildAttentionItems(input: AttentionInput): AttentionItem[] {
  const hoje = input.hoje ?? new Date();
  const itens: AttentionItem[] = [];

  // 1. Compras registradas sem pagamento ("Pagar depois" e boletos pendentes).
  for (const p of input.purchases) {
    if (p.status_pagamento !== "PENDENTE_PAGAMENTO" && p.status_pagamento !== "PARCIALMENTE_PAGA")
      continue;
    const prevista = p.data_prevista_pagamento;
    const dias = prevista ? diasAte(prevista, hoje) : null;
    const prioridade: Prioridade = dias === null ? "MEDIA" : (prioridadePorPrazo(dias) ?? "BAIXA");
    itens.push({
      id: `compra-${p.id}`,
      prioridade,
      titulo: `Pagamento pendente · ${p.estabelecimento}`,
      detalhe:
        dias === null
          ? "Compra registrada sem data prevista de pagamento"
          : `Pagamento previsto ${prazoTexto(dias)}`,
      valor: Number(p.valor_total) || 0,
      acao: { label: "Registrar pagamento", purchaseId: p.id },
    });
  }

  // 2. Faturas de cartão em aberto perto do vencimento ou vencidas.
  for (const f of input.invoices) {
    if (f.status === "PAGA") continue;
    if ((Number(f.valor_total) || 0) <= 0) continue;
    const dias = diasAte(f.data_vencimento, hoje);
    const prioridade = prioridadePorPrazo(dias);
    if (!prioridade) continue;
    itens.push({
      id: `fatura-${f.id}`,
      prioridade,
      titulo: `Fatura do cartão ${input.cardName(f.credit_card_id)}`,
      detalhe: `Fatura ${prazoTexto(dias)}`,
      valor: Number(f.valor_total) || 0,
      acao: { label: "Pagar fatura", to: "/cartoes/$cardId", params: { cardId: f.credit_card_id } },
    });
  }

  // 3. Contas recorrentes cadastradas (dia fixo de vencimento).
  for (const c of input.fixedExpenses) {
    if (!c.ativo) continue;
    const venc = proximoVencimentoDoDia(c.vencimento, hoje);
    const dias = diasAte(iso(venc), hoje);
    const prioridade = prioridadePorPrazo(dias);
    if (!prioridade) continue;
    itens.push({
      id: `conta-${c.id}`,
      prioridade,
      titulo: `Conta recorrente · ${c.descricao}`,
      detalhe: `Conta ${prazoTexto(dias)}`,
      valor: Number(c.valor) || 0,
      acao: { label: "Ver contas", to: "/configuracoes" },
    });
  }

  // 4. Assinaturas e recorrências ativas com cobrança próxima.
  for (const r of input.recurring) {
    if (!r.ativo) continue;
    const dias = diasAte(r.proxima_cobranca, hoje);
    const prioridade = prioridadePorPrazo(dias);
    if (!prioridade) continue;
    itens.push({
      id: `recorrencia-${r.id}`,
      prioridade,
      titulo: `Recorrência · ${r.nome}`,
      detalhe: `Cobrança ${prazoTexto(dias)}`,
      valor: Number(r.valor) || 0,
      acao: r.credit_card_id
        ? { label: "Ver cartão", to: "/cartoes/$cardId", params: { cardId: r.credit_card_id } }
        : { label: "Ver compras", to: "/compras" },
    });
  }

  // 5. Itens de compra sem categoria (qualidade dos dados, nunca urgente).
  if (input.itensSemCategoria > 0) {
    itens.push({
      id: "sem-categoria",
      prioridade: "BAIXA",
      titulo: `${input.itensSemCategoria} produto(s) sem categoria`,
      detalhe: "Classificar melhora a análise de consumo do Dashboard",
      acao: { label: "Corrigir", to: "/compras" },
    });
  }

  // 6. Documentos enviados aguardando revisão.
  if (input.documentosPendentes > 0) {
    itens.push({
      id: "documentos",
      prioridade: "MEDIA",
      titulo: `${input.documentosPendentes} nota(s) aguardando revisão`,
      detalhe: "Confirme os dados para virar compra",
      acao: { label: "Revisar", to: "/compras" },
    });
  }

  return itens.sort((a, b) => {
    const ordem = ORDEM[a.prioridade] - ORDEM[b.prioridade];
    if (ordem !== 0) return ordem;
    return (b.valor ?? 0) - (a.valor ?? 0);
  });
}
