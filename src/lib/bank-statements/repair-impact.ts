/**
 * IMPACTO FINANCEIRO DO REPARO — SOMENTE LEITURA, SOMENTE SIMULAÇÃO.
 *
 * O plano de reparo (`repair-plan.ts`) diz O QUE precisaria ser corrigido.
 * Este módulo responde a pergunta seguinte, que é a que o operador realmente
 * precisa antes de autorizar qualquer coisa:
 *
 *   "Se eu aplicar este reparo, QUAL movimento volta, em QUE dia, e QUANTO
 *    muda o saldo da conta a partir dali?"
 *
 * Nada aqui grava, corrige ou recria movimento. É aritmética sobre o que o
 * lineage já provou, item a item, com alvo concreto (`itemId`).
 */
import type { StatementLineage, LineageRow } from "./lineage";

export type RepairImpactKind = "MOVIMENTO_PERDIDO" | "TRANSFERENCIA_SEM_PROVA";

export const REPAIR_IMPACT_LABELS: Record<RepairImpactKind, string> = {
  MOVIMENTO_PERDIDO: "Movimento do documento que não chegou ao extrato",
  TRANSFERENCIA_SEM_PROVA: "Transferência automática sem contrapartida comprovada",
};

export type RepairImpactRow = {
  kind: RepairImpactKind;
  importId: string;
  nomeArquivo: string;
  itemId: string;
  sourceId: string;
  data: string | null;
  descricao: string;
  valor: number;
  direcao: "IN" | "OUT";
  /** Quanto o saldo da conta muda a partir da data, se o reparo for aplicado. */
  deltaSaldo: number;
  motivo: string;
};

export type RepairImpactPeriod = {
  importId: string;
  nomeArquivo: string;
  periodStart: string | null;
  periodEnd: string | null;
  linhas: RepairImpactRow[];
  /** Efeito no saldo final deste período, isoladamente. */
  deltaPeriodo: number;
  /** Saldo do sistema no fim do período depois do reparo (acumulado). */
  saldoFinalDocumento: number | null;
  saldoFinalCorrigido: number | null;
};

export type RepairImpact = {
  geradoEm: string;
  dryRun: true;
  periodos: RepairImpactPeriod[];
  totalLinhas: number;
  /** Efeito acumulado no saldo atual da conta, se tudo for reparado. */
  deltaSaldoAtual: number;
};

function linhaImpacto(
  lin: StatementLineage,
  r: LineageRow,
  kind: RepairImpactKind,
  motivo: string,
): RepairImpactRow {
  // Reconstruir um movimento perdido devolve o efeito econômico original;
  // desfazer uma transferência sem prova não muda o saldo desta conta.
  const delta =
    kind === "MOVIMENTO_PERDIDO" ? (r.direction === "IN" ? r.amount : -r.amount) : 0;
  return {
    kind,
    importId: lin.importId,
    nomeArquivo: lin.nomeArquivo,
    itemId: r.itemId,
    sourceId: r.sourceId,
    data: r.postingDate,
    descricao: r.description,
    valor: r.amount,
    direcao: r.direction,
    deltaSaldo: delta,
    motivo,
  };
}

/** Simulação pura: recebe o lineage já calculado, devolve o impacto por período. */
export function analyzeRepairImpact(input: { lineages: StatementLineage[] }): RepairImpact {
  const periodos: RepairImpactPeriod[] = [];
  let acumulado = 0;

  const ordenados = [...input.lineages].sort((a, b) =>
    String(a.periodStart ?? "").localeCompare(String(b.periodStart ?? "")),
  );

  for (const lin of ordenados) {
    const perdidos = lin.rows.filter(
      (r) => r.finalStatus === "SKIPPED_DUPLICATE" && !r.matchedAgainst,
    );
    const ausentes = lin.missingFromLedger.filter(
      (r) => r.finalStatus !== "SKIPPED_DUPLICATE" && r.finalStatus !== "REJECTED",
    );
    const transferencias = lin.rows.filter(
      (r) => r.reviewAction === "MATCH_TRANSFER" && r.reconciliationStatus === "POSSIBLE_MATCH",
    );

    const linhas: RepairImpactRow[] = [
      ...perdidos.map((r) =>
        linhaImpacto(
          lin,
          r,
          "MOVIMENTO_PERDIDO",
          "Descartado como duplicata sem alvo concreto — a repetição é legítima no documento.",
        ),
      ),
      ...ausentes.map((r) =>
        linhaImpacto(
          lin,
          r,
          "MOVIMENTO_PERDIDO",
          "O documento traz o lançamento, mas não existe movimento correspondente no extrato do sistema.",
        ),
      ),
      ...transferencias.map((r) =>
        linhaImpacto(
          lin,
          r,
          "TRANSFERENCIA_SEM_PROVA",
          "Virou transferência por sugestão, sem movimento oposto comprovado em outra conta.",
        ),
      ),
    ].sort((a, b) => String(a.data ?? "").localeCompare(String(b.data ?? "")));

    if (!linhas.length) continue;

    const deltaPeriodo = linhas.reduce((acc, l) => acc + l.deltaSaldo, 0);
    acumulado = Math.round((acumulado + deltaPeriodo) * 100) / 100;
    const saldoFinalDocumento = lin.saldoFinalDocumento ?? null;

    periodos.push({
      importId: lin.importId,
      nomeArquivo: lin.nomeArquivo,
      periodStart: lin.periodStart,
      periodEnd: lin.periodEnd,
      linhas,
      deltaPeriodo: Math.round(deltaPeriodo * 100) / 100,
      saldoFinalDocumento,
      saldoFinalCorrigido: null,
    });
  }

  return {
    geradoEm: new Date().toISOString(),
    dryRun: true,
    periodos,
    totalLinhas: periodos.reduce((acc, p) => acc + p.linhas.length, 0),
    deltaSaldoAtual: acumulado,
  };
}
