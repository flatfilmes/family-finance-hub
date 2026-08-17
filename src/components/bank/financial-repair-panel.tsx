/**
 * FINANCIAL_REPAIR_DRY_RUN — PAINEL SOMENTE LEITURA.
 *
 * Mostra os candidatos de reparo (remoção da entrada artificial e inversão de
 * sentido dos rendimentos), a simulação de saldo, os checkpoints depois da
 * simulação e a seleção do extrato canônico. Nenhum botão aqui grava nada.
 */
import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import type { FinancialRepairDryRun, RepairCandidate } from "@/lib/bank-statements/financial-repair";
import { formatCurrency } from "@/lib/finance";

function CandidateCard({ c }: { c: RepairCandidate }) {
  const remover = c.acao === "REMOVE_CANDIDATE";
  return (
    <div
      className={`rounded-2xl border px-4 py-3 ${remover ? "border-destructive/50 bg-destructive/5" : "border-border bg-muted/30"}`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <StatusBadge tone={remover ? "danger" : "warn"}>{c.acao}</StatusBadge>
        <span className="text-sm font-semibold">{formatCurrency(c.valor)}</span>
        <span className="text-sm text-muted-foreground">
          {c.data} ·{" "}
          {c.direcaoCorreta ? `${c.direcaoAtual} → ${c.direcaoCorreta}` : c.direcaoAtual}
        </span>
      </div>
      <p className="mt-2 text-sm">{c.descricao}</p>
      <p className="mt-1 text-xs text-muted-foreground">{c.accountLabel} · {c.origem}</p>
      <p className="mt-2 font-mono text-[11px] leading-relaxed text-muted-foreground">
        transaction_id {c.transactionId}
        <br />
        account_id {c.accountId ?? "—"} · tipo {c.tipo}
        <br />
        source_id {c.sourceId ?? "—"} · statement_item_id {c.statementItemId ?? "—"}
        <br />
        transfer_group_id {c.transferGroupId ?? "—"} · created_at {c.createdAt ?? "—"}
      </p>
      <p className="mt-2 text-xs">
        Efeito simulado no saldo:{" "}
        <span className="font-semibold">
          {c.efeitoSaldo >= 0 ? "+" : "−"}
          {formatCurrency(Math.abs(c.efeitoSaldo))}
        </span>
      </p>

      <ul className="mt-2 space-y-1">
        {c.provas.map((p) => (
          <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 text-xs">
            <span>
              <span className="font-medium">{p.label}</span>
              <span className="block text-muted-foreground">{p.detail}</span>
            </span>
            <StatusBadge tone={p.status === "PASS" ? "ok" : "danger"}>{p.status}</StatusBadge>
          </li>
        ))}
      </ul>

      {c.contraparte && (
        <div className="mt-3 rounded-xl border border-border bg-background px-3 py-2">
          <StatusBadge tone="ok">PRESERVAR</StatusBadge>
          <p className="mt-1 text-sm font-semibold">{c.contraparte.accountLabel}</p>
          <p className="text-sm">
            {c.contraparte.data} · {c.contraparte.direcao} {formatCurrency(c.contraparte.valor)}
          </p>
          <p className="text-xs text-muted-foreground">{c.contraparte.descricao}</p>
          <p className="mt-1 font-mono text-[11px] text-muted-foreground">
            id {c.contraparte.transactionId}
          </p>
        </div>
      )}
    </div>
  );
}

export function FinancialRepairPanel({ plano }: { plano: FinancialRepairDryRun }) {
  return (
    <Card className="mb-5">
      <SectionTitle
        title="FINANCIAL_REPAIR_DRY_RUN — reparo simulado do ledger"
        hint="Somente leitura: nenhum DELETE, nenhum UPDATE, nenhuma alteração de transfer_group e nenhuma seleção canônica persistida."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={plano.aprovado ? "ok" : "warn"}>
          {plano.aprovado ? "SIMULAÇÃO APROVADA" : "SIMULAÇÃO COM RESSALVAS"}
        </StatusBadge>
        <p className="text-sm text-muted-foreground">{plano.resumo}</p>
      </div>

      <div className="mb-5 grid gap-3 sm:grid-cols-3">
        <div className="rounded-2xl border border-border px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Ledger</p>
          <p className="text-lg font-semibold">
            {plano.ledger.antes} → {plano.ledger.depois}
          </p>
          <p className="text-xs text-muted-foreground">
            Documento canônico: {plano.ledger.documento} movimentos
          </p>
        </div>
        <div className="rounded-2xl border border-border px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Saldo</p>
          <p className="text-lg font-semibold">
            {formatCurrency(plano.saldo.antes)} → {formatCurrency(plano.saldo.depois)}
          </p>
          <p className="text-xs text-muted-foreground">
            Diferença residual: {formatCurrency(plano.saldo.residual)}
          </p>
        </div>
        <div className="rounded-2xl border border-border px-4 py-3">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">Checkpoints</p>
          <p className="text-lg font-semibold">
            {plano.checkpointsResumo.conferem}/{plano.checkpointsResumo.total}{" "}
            {plano.checkpointsResumo.ok ? "PASS" : "conferem"}
          </p>
          <p className="text-xs text-muted-foreground">Canônicos (DAILY) do extrato eleito</p>
        </div>
      </div>

      {plano.candidatos.length > 0 && (
        <div className="mb-5 grid gap-3 lg:grid-cols-2">
          {plano.candidatos.map((c) => (
            <CandidateCard key={`${c.acao}-${c.transactionId}`} c={c} />
          ))}
        </div>
      )}

      <div className="mb-5 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-muted-foreground">
              <th className="py-2">Checkpoint</th>
              <th className="py-2">Banco</th>
              <th className="py-2">Calculado antes</th>
              <th className="py-2">Diferença antes</th>
              <th className="py-2">Calculado depois</th>
              <th className="py-2">Diferença depois</th>
            </tr>
          </thead>
          <tbody>
            {plano.checkpoints.map((c) => (
              <tr key={c.data} className="border-t border-border">
                <td className="py-2">{c.data}</td>
                <td className="py-2">{formatCurrency(c.banco)}</td>
                <td className="py-2">{formatCurrency(c.calculadoAntes)}</td>
                <td className="py-2">{formatCurrency(c.diferencaAntes)}</td>
                <td className="py-2 font-semibold">{formatCurrency(c.calculadoDepois)}</td>
                <td className="py-2">
                  <StatusBadge tone={c.confereDepois ? "ok" : "danger"}>
                    {formatCurrency(c.diferencaDepois)}
                  </StatusBadge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="rounded-2xl border border-border px-4 py-3 text-sm">
        <p className="font-semibold">AUDIT_STATEMENT_SELECTION</p>
        <ul className="mt-1 space-y-1 text-muted-foreground">
          <li>imports found = {plano.selecao.importsEncontrados}</li>
          <li>canonical = {plano.canonico.importId ?? "—"}</li>
          <li>same-period overlap = {String(plano.selecao.samePeriodOverlap)}</li>
          <li>false continuity warning = {plano.selecao.falseContinuityRemoved ? "removed" : "n/a"}</li>
          <li>canonical checkpoints = {plano.canonico.checkpointsCanonicos}</li>
          <li>
            período canônico = {plano.canonico.periodStart ?? "—"} → {plano.canonico.periodEnd ?? "—"} ·
            opening {plano.canonico.openingDate ?? "—"} ={" "}
            {plano.canonico.openingBalance === null
              ? "—"
              : formatCurrency(plano.canonico.openingBalance)}
          </li>
        </ul>

        <div className="mt-3 space-y-2">
          {plano.selecao.grupos.map((g) => (
            <div key={g.chave} className="rounded-xl border border-border px-3 py-2">
              <div className="flex flex-wrap items-center gap-2">
                <StatusBadge tone={g.relacao === "SAME_PERIOD_OVERLAP" ? "warn" : "muted"}>
                  {g.relacao}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">
                  {g.periodStart ?? "—"} → {g.periodEnd ?? "—"}
                </span>
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {g.candidatos.map((c) => (
                  <li key={c.importId} className="flex flex-wrap items-center gap-2">
                    <StatusBadge tone={c.canonical ? "ok" : "muted"}>
                      {c.canonical ? "CANÔNICO" : "PRESERVADO"}
                    </StatusBadge>
                    <span className="font-mono">{c.importId}</span>
                    <span className="text-muted-foreground">
                      score {c.score} · opening {c.openingDate ?? "—"}
                      {c.temOpeningPersistido ? " (persistido)" : ""} · {c.checkpointsDaily}{" "}
                      checkpoint(s) · {c.itensLigados}/{c.itens} linhas ligadas
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <pre className="mt-4 overflow-x-auto rounded-2xl bg-muted/40 p-4 text-[11px] leading-relaxed">
        {JSON.stringify(
          {
            tipo: plano.tipo,
            dryRun: plano.dryRun,
            candidatos: plano.candidatos.map((c) => ({
              acao: c.acao,
              transaction_id: c.transactionId,
              data: c.data,
              valor: c.valor,
              direcao: c.direcaoCorreta
                ? `${c.direcaoAtual} → ${c.direcaoCorreta}`
                : c.direcaoAtual,
              efeito_saldo: c.efeitoSaldo,
              source_id: c.sourceId,
            })),
            ledger: plano.ledger,
            saldo: plano.saldo,
            checkpoints: `${plano.checkpointsResumo.conferem}/${plano.checkpointsResumo.total} PASS`,
            audit_statement_selection: {
              imports_found: plano.selecao.importsEncontrados,
              canonical: plano.canonico.importId,
              same_period_overlap: plano.selecao.samePeriodOverlap,
              false_continuity_warning: plano.selecao.falseContinuityRemoved ? "removed" : "n/a",
              canonical_checkpoints: plano.canonico.checkpointsCanonicos,
            },
          },
          null,
          2,
        )}
      </pre>
    </Card>
  );
}
