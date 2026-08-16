import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import type { CardInvoice, ExpenseInstallment } from "@/lib/card-invoices";
import type { BankAccount } from "@/lib/bank-accounts";
import type { FixedExpense, Income } from "@/lib/finance";
import type { Purchase } from "@/lib/purchases";
import type { RecurringExpense } from "@/lib/recurring-expenses";
import type { Transaction } from "@/lib/transactions";
import { buildSpendingBreakdown } from "@/lib/monthly-spending";
import {
  buildCommitments,
  endOfMonthIso,
  guaranteedMonthlyIncome,
  nextIncomeDate,
  todayIso,
} from "@/lib/free-cash";
import {
  averageVariableIncome,
  healthStatus,
  type HealthStatus,
} from "@/lib/financial-engine";

export type MonthlySnapshot = Database["public"]["Tables"]["monthly_snapshots"]["Row"];
export type MonthlyClosingLog = Database["public"]["Tables"]["monthly_closing_logs"]["Row"];

/* -------------------------------------------------------------------------- */
/* Competência (ano + mês) — referência única do histórico                     */
/* -------------------------------------------------------------------------- */

export type Competencia = { ano: number; mes: number };

export function competenciaFromMonth(month: string): Competencia {
  const [ano, mes] = month.split("-").map(Number);
  return { ano: ano ?? 1970, mes: mes ?? 1 };
}

export function monthFromCompetencia(c: Competencia) {
  return `${c.ano}-${String(c.mes).padStart(2, "0")}`;
}

export function competenciaLabel(c: Competencia) {
  return new Date(c.ano, c.mes - 1, 1).toLocaleDateString("pt-BR", {
    month: "long",
    year: "numeric",
  });
}

export function previousCompetencia(c: Competencia): Competencia {
  return c.mes === 1 ? { ano: c.ano - 1, mes: 12 } : { ano: c.ano, mes: c.mes - 1 };
}

/** Fim da competência já passou (ou estamos nos últimos 5 dias dela). */
export function podeFechar(c: Competencia, hoje = todayIso()) {
  const month = monthFromCompetencia(c);
  const fim = endOfMonthIso(month);
  if (hoje > fim) return true;
  if (hoje.slice(0, 7) !== month) return false;
  const dia = Number(hoje.slice(8, 10));
  const ultimo = Number(fim.slice(8, 10));
  return ultimo - dia <= 5;
}

/* -------------------------------------------------------------------------- */
/* Cálculo do retrato financeiro (mesmas regras do Dashboard)                  */
/* -------------------------------------------------------------------------- */

export type SnapshotAlert = { tipo: string; descricao: string };

export type SnapshotDraft = {
  ano: number;
  mes: number;
  member_id: string | null;
  renda_fixa: number;
  renda_variavel_prevista: number;
  renda_variavel_recebida: number;
  receita_total_real: number;
  saldo_bancario_final: number;
  gastos_realizados: number;
  compras_pix_debito_dinheiro: number;
  compras_cartao: number;
  parcelas_do_mes: number;
  recorrencias_do_mes: number;
  contas_recorrentes_do_mes: number;
  faturas_em_aberto: number;
  faturas_pagas: number;
  comprometido_final: number;
  reserva_final: number;
  dinheiro_livre_final: number;
  status_saude_financeira: HealthStatus;
  alertas: SnapshotAlert[];
};

function clampToMonth(dateIso: string, month: string) {
  const inicio = `${month}-01`;
  const fim = endOfMonthIso(month);
  if (dateIso < inicio) return inicio;
  if (dateIso > fim) return fim;
  return dateIso;
}

/**
 * Retrato financeiro de uma competência, calculado com as mesmas regras já
 * usadas no Dashboard (gasto por competência, comprometido pendente,
 * dinheiro livre e saúde financeira). O resultado é congelado no fechamento.
 */
export function buildSnapshotDraft(input: {
  month: string;
  memberId: string | null;
  incomes: Income[];
  fixed: FixedExpense[];
  purchases: Purchase[];
  installments: ExpenseInstallment[];
  recurring: RecurringExpense[];
  invoices: CardInvoice[];
  accounts: BankAccount[];
  transactions: Transaction[];
  percentualReserva: number;
  semCategoria?: number;
  hoje?: string;
}): SnapshotDraft {
  const { month } = input;
  const { ano, mes } = competenciaFromMonth(month);
  const inicio = `${month}-01`;
  const fim = endOfMonthIso(month);
  const referencia = clampToMonth(input.hoje ?? todayIso(), month);

  // --- Receitas ---------------------------------------------------------
  const renda_fixa = guaranteedMonthlyIncome(input.incomes);
  const renda_variavel_prevista = averageVariableIncome(input.incomes);

  const entradas = input.transactions
    .filter(
      (t) =>
        t.tipo === "ENTRADA" &&
        t.status === "CONFIRMADA" &&
        t.data_movimento >= inicio &&
        t.data_movimento <= fim,
    )
    .reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  // Renda variável recebida = o que entrou de fato além da renda fixa garantida.
  const renda_variavel_recebida = entradas > 0 ? Math.max(0, entradas - renda_fixa) : 0;
  const receita_total_real = renda_fixa + renda_variavel_recebida;

  // --- Gastos da competência -------------------------------------------
  const gastos = buildSpendingBreakdown({
    month,
    purchases: input.purchases,
    installments: input.installments.map((i) => ({
      purchase_id: i.purchase_id,
      numero_parcela: i.numero_parcela,
      total_parcelas: i.total_parcelas,
      valor_parcela: i.valor_parcela,
      data_vencimento: i.data_vencimento,
      member_id: i.member_id,
    })),
    recurring: input.recurring,
    fixed: input.fixed,
  });

  // --- Bancos -----------------------------------------------------------
  const contasAtivas = input.accounts.filter((a) => a.ativo);
  const saldo_bancario_final = contasAtivas.reduce(
    (acc, a) => acc + (Number(a.saldo_atual) || 0),
    0,
  );

  // --- Faturas ----------------------------------------------------------
  const faturasDoMes = input.invoices.filter(
    (i) => i.data_vencimento >= inicio && i.data_vencimento <= fim,
  );
  const faturas_em_aberto = faturasDoMes
    .filter((i) => i.status !== "PAGA")
    .reduce((acc, i) => acc + (Number(i.valor_total) || 0), 0);

  // Pagamento de fatura é movimentação de caixa — nunca novo consumo.
  const faturas_pagas = input.transactions
    .filter(
      (t) =>
        t.tipo === "PAGAMENTO_CARTAO" &&
        t.status === "CONFIRMADA" &&
        t.data_movimento >= inicio &&
        t.data_movimento <= fim,
    )
    .reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  // --- Comprometido e dinheiro livre ------------------------------------
  const base = {
    month,
    fixed: input.fixed,
    invoices: input.invoices,
    installments: input.installments,
    recurring: input.recurring,
    purchases: input.purchases,
  };

  const comprometido = buildCommitments({ ...base, from: referencia, to: fim });
  const proximoRecebimento = nextIncomeDate(input.incomes, referencia);
  const janela = buildCommitments({
    ...base,
    from: referencia,
    to: proximoRecebimento ?? fim,
  });

  const reserva_final = (renda_fixa * (input.percentualReserva || 0)) / 100;
  const dinheiro_livre_final = saldo_bancario_final - janela.total - reserva_final;

  const status_saude_financeira = healthStatus({
    disponivel: dinheiro_livre_final,
    receita: receita_total_real,
    compromissos: comprometido.total,
  });

  // --- Alertas (não impedem o fechamento) -------------------------------
  const alertas: SnapshotAlert[] = [];
  if (comprometido.contasRecorrentes > 0) {
    alertas.push({
      tipo: "Contas pendentes",
      descricao: "Existem contas recorrentes desta competência ainda em aberto.",
    });
  }
  const faturasAbertas = faturasDoMes.filter((i) => i.status !== "PAGA").length;
  if (faturasAbertas > 0) {
    alertas.push({
      tipo: "Faturas não pagas",
      descricao: `${faturasAbertas} fatura(s) de cartão com vencimento no período ainda não foram pagas.`,
    });
  }
  if ((input.semCategoria ?? 0) > 0) {
    alertas.push({
      tipo: "Compras sem categoria",
      descricao: `${input.semCategoria} item(ns) de compra sem categoria definida.`,
    });
  }
  const pendentes = input.transactions.filter(
    (t) => t.status === "PENDENTE" && t.data_movimento >= inicio && t.data_movimento <= fim,
  ).length;
  if (pendentes > 0) {
    alertas.push({
      tipo: "Movimentações pendentes",
      descricao: `${pendentes} movimentação(ões) ainda não confirmada(s) na competência.`,
    });
  }
  if (renda_variavel_prevista > 0 && renda_variavel_recebida < renda_variavel_prevista) {
    alertas.push({
      tipo: "Renda variável não confirmada",
      descricao:
        "A renda variável prevista é maior do que a efetivamente recebida no período. O fechamento usa o valor recebido.",
    });
  }

  return {
    ano,
    mes,
    member_id: input.memberId,
    renda_fixa,
    renda_variavel_prevista,
    renda_variavel_recebida,
    receita_total_real,
    saldo_bancario_final,
    gastos_realizados: gastos.total,
    compras_pix_debito_dinheiro: gastos.caixa,
    compras_cartao: gastos.cartaoAVista,
    parcelas_do_mes: gastos.parcelasDoMes,
    recorrencias_do_mes: gastos.recorrencias,
    contas_recorrentes_do_mes: gastos.contasRecorrentes,
    faturas_em_aberto,
    faturas_pagas,
    comprometido_final: comprometido.total,
    reserva_final,
    dinheiro_livre_final,
    status_saude_financeira,
    alertas,
  };
}

/* -------------------------------------------------------------------------- */
/* Persistência                                                                */
/* -------------------------------------------------------------------------- */

export async function fetchSnapshots(familyId: string) {
  const { data, error } = await supabase
    .from("monthly_snapshots")
    .select("*")
    .eq("family_id", familyId)
    .order("ano", { ascending: false })
    .order("mes", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchClosingLogs(familyId: string) {
  const { data, error } = await supabase
    .from("monthly_closing_logs")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) throw error;
  return data ?? [];
}

function toRow(familyId: string, userId: string | null, draft: SnapshotDraft) {
  const { alertas: _alertas, ...valores } = draft;
  return {
    ...valores,
    family_id: familyId,
    fechado: true,
    fechado_em: new Date().toISOString(),
    fechado_por: userId,
    reaberto_em: null,
    reaberto_por: null,
    motivo_reabertura: null,
  };
}

/**
 * Fecha a competência criando o snapshot familiar e os snapshots individuais.
 * Reabertura anterior é sobrescrita, mas a auditoria preserva o histórico.
 */
export async function closeMonth(input: {
  familyId: string;
  userId: string | null;
  drafts: SnapshotDraft[];
}) {
  const { familyId, userId, drafts } = input;
  const familiar = drafts.find((d) => d.member_id === null);
  if (!familiar) throw new Error("Snapshot familiar obrigatório");

  const existentes = await fetchSnapshots(familyId);

  const salvos: MonthlySnapshot[] = [];
  for (const draft of drafts) {
    const anterior = existentes.find(
      (s) => s.ano === draft.ano && s.mes === draft.mes && s.member_id === draft.member_id,
    );
    const row = toRow(familyId, userId, draft);
    if (anterior) {
      const { data, error } = await supabase
        .from("monthly_snapshots")
        .update(row)
        .eq("id", anterior.id)
        .select()
        .single();
      if (error) throw error;
      salvos.push(data);
    } else {
      const { data, error } = await supabase
        .from("monthly_snapshots")
        .insert(row)
        .select()
        .single();
      if (error) throw error;
      salvos.push(data);
    }
  }

  const snapshotFamiliar = salvos.find((s) => s.member_id === null) ?? salvos[0];
  const { error: logError } = await supabase.from("monthly_closing_logs").insert({
    family_id: familyId,
    snapshot_id: snapshotFamiliar?.id ?? null,
    ano: familiar.ano,
    mes: familiar.mes,
    acao: "FECHAR_MES",
    created_by: userId,
  });
  if (logError) throw logError;

  return salvos;
}

/** Reabre a competência (somente administrador familiar) mantendo registro. */
export async function reopenMonth(input: {
  familyId: string;
  userId: string | null;
  ano: number;
  mes: number;
  motivo?: string | undefined;
}) {
  const { error } = await supabase
    .from("monthly_snapshots")
    .update({
      fechado: false,
      reaberto_em: new Date().toISOString(),
      reaberto_por: input.userId,
      motivo_reabertura: input.motivo ?? null,
    })
    .eq("family_id", input.familyId)
    .eq("ano", input.ano)
    .eq("mes", input.mes);
  if (error) throw error;

  const { error: logError } = await supabase.from("monthly_closing_logs").insert({
    family_id: input.familyId,
    ano: input.ano,
    mes: input.mes,
    acao: "REABRIR_MES",
    motivo: input.motivo ?? null,
    created_by: input.userId,
  });
  if (logError) throw logError;
}

/* -------------------------------------------------------------------------- */
/* Comparação entre competências                                               */
/* -------------------------------------------------------------------------- */

export function variacao(atual: number, anterior: number) {
  if (!anterior) return null;
  return ((atual - anterior) / Math.abs(anterior)) * 100;
}

export function formatVariacao(valor: number | null) {
  if (valor === null || !Number.isFinite(valor)) return "—";
  const sinal = valor > 0 ? "+" : "";
  return `${sinal}${valor.toFixed(1)}%`;
}
