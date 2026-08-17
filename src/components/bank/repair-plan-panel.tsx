/**
 * PLANO DE REPARO — VISUALIZAÇÃO EM DRY RUN.
 *
 * Mostra o que precisaria ser corrigido no que já foi importado. Nenhum botão
 * aqui executa nada: reparo financeiro só acontece com decisão humana, em uma
 * etapa separada.
 */
import { useMemo } from "react";

import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import {
  buildRepairPlan,
  REPAIR_LABELS,
  type RepairSeverity,
} from "@/lib/bank-statements/repair-plan";
import type {
  LineageImportInput,
  LineageItemInput,
  StatementLineage,
} from "@/lib/bank-statements/lineage";
import { formatCurrency } from "@/lib/finance";

const TONE: Record<RepairSeverity, "success" | "warning" | "danger"> = {
  INFO: "success",
  ATENCAO: "warning",
  CRITICO: "danger",
};

const SEVERIDADE: Record<RepairSeverity, string> = {
  INFO: "Ajuste de registro",
  ATENCAO: "Requer atenção",
  CRITICO: "Impacta o saldo",
};

export function RepairPlanPanel({
  lineages,
  imports,
  items,
  checkpoints,
}: {
  lineages: StatementLineage[];
  imports: LineageImportInput[];
  items: LineageItemInput[];
  checkpoints: { id?: string | null; data: string; tipo?: string | null; importId?: string | null }[];
}) {
  const plano = useMemo(
    () => buildRepairPlan({ lineages, imports, items, checkpoints }),
    [lineages, imports, items, checkpoints],
  );

  if (!plano.acoes.length) return null;

  return (
    <Card className="mb-5">
      <SectionTitle
        title="Plano de reparo (simulação)"
        hint="Nada foi executado. Esta é apenas a lista do que precisaria ser corrigido no que já está importado."
      />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Resumo titulo="Correções de registro" valor={String(plano.resumo.metadados)} />
        <Resumo titulo="Decisões financeiras" valor={String(plano.resumo.financeiros)} />
        <Resumo
          titulo="Valor sob revisão"
          valor={formatCurrency(plano.resumo.valorEnvolvido)}
        />
      </div>
      <div className="space-y-3">
        {plano.acoes.map((a, i) => (
          <div key={`${a.kind}-${a.importId}-${i}`} className="rounded-2xl border border-border px-4 py-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-semibold">{REPAIR_LABELS[a.kind]}</p>
              <StatusBadge tone={TONE[a.severity]}>{SEVERIDADE[a.severity]}</StatusBadge>
            </div>
            <p className="mt-1 text-xs text-muted-foreground">
              {a.nomeArquivo} · {a.quantidade} {a.quantidade === 1 ? "registro" : "registros"}
              {a.valorEnvolvido > 0 ? ` · ${formatCurrency(a.valorEnvolvido)}` : ""}
            </p>
            <p className="mt-2 text-sm">{a.motivo}</p>
            <p className="mt-1 text-sm text-muted-foreground">{a.efeito}</p>
            {a.exigeConfirmacaoHumana && (
              <p className="mt-2 text-xs font-medium text-muted-foreground">
                Só pode ser aplicado com conferência de quem opera a conta.
              </p>
            )}
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
