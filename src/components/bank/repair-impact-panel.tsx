/**
 * IMPACTO DO REPARO — TABELA DE CONFERÊNCIA (DRY RUN).
 *
 * Mostra, linha a linha, exatamente qual movimento voltaria, em que dia, e
 * quanto o saldo da conta mudaria a partir dali. Nenhum botão aqui executa
 * nada: reparo financeiro só acontece com decisão humana.
 */
import { useMemo } from "react";

import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import {
  analyzeRepairImpact,
  REPAIR_IMPACT_LABELS,
  type RepairImpactKind,
} from "@/lib/bank-statements/repair-impact";
import type { StatementLineage } from "@/lib/bank-statements/lineage";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";

const TONE: Record<RepairImpactKind, "danger" | "warn"> = {
  MOVIMENTO_PERDIDO: "danger",
  TRANSFERENCIA_SEM_PROVA: "warn",
};

export function RepairImpactPanel({ lineages }: { lineages: StatementLineage[] }) {
  const impacto = useMemo(() => analyzeRepairImpact({ lineages }), [lineages]);

  if (!impacto.totalLinhas) return null;

  return (
    <Card className="mb-5">
      <SectionTitle
        title="Impacto do reparo no saldo (simulação)"
        hint="Nada foi executado. Esta é a conta exata do que mudaria se cada correção fosse aplicada."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Resumo titulo="Lançamentos sob revisão" valor={String(impacto.totalLinhas)} />
        <Resumo
          titulo="Efeito no saldo atual da conta"
          valor={`${impacto.deltaSaldoAtual >= 0 ? "+" : "−"}${formatCurrency(Math.abs(impacto.deltaSaldoAtual))}`}
        />
      </div>

      <div className="space-y-4">
        {impacto.periodos.map((p) => (
          <div key={p.importId} className="rounded-2xl border border-border">
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-4 py-3">
              <div>
                <p className="text-sm font-semibold">{p.nomeArquivo}</p>
                <p className="text-xs text-muted-foreground">
                  {p.periodStart ? formatDate(p.periodStart) : "—"} a{" "}
                  {p.periodEnd ? formatDate(p.periodEnd) : "—"}
                </p>
              </div>
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Efeito no período</p>
                <p className="text-sm font-semibold">
                  {p.deltaPeriodo >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(p.deltaPeriodo))}
                </p>
              </div>
            </div>

            <div className="divide-y divide-border">
              {p.linhas.map((l) => (
                <div key={l.itemId} className="px-4 py-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="text-sm font-medium">{l.descricao}</p>
                    <StatusBadge tone={TONE[l.kind]}>{REPAIR_IMPACT_LABELS[l.kind]}</StatusBadge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {l.data ? formatDate(l.data) : "sem data"} ·{" "}
                    {l.direcao === "IN" ? "entrada" : "saída"} de {formatCurrency(l.valor)} ·
                    identidade {l.sourceId}
                  </p>
                  <p className="mt-2 text-sm">{l.motivo}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {l.deltaSaldo === 0
                      ? "O saldo desta conta não muda — a correção é de classificação."
                      : `Se reparado, o saldo da conta muda ${l.deltaSaldo >= 0 ? "+" : "−"}${formatCurrency(Math.abs(l.deltaSaldo))} a partir desta data.`}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

function Resumo({ titulo, valor }: { titulo: string; valor: string }) {
  return (
    <div className="rounded-2xl border border-border px-4 py-3">
      <p className="text-xs text-muted-foreground">{titulo}</p>
      <p className="mt-1 text-lg font-semibold">{valor}</p>
    </div>
  );
}
