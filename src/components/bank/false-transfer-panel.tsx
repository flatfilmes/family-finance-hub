/**
 * CONTRAPARTIDA DE TRANSFERÊNCIA FALSA — PAINEL SOMENTE LEITURA.
 *
 * Mostra o par (perna real × contrapartida artificial), as provas de
 * identidade, o antes/depois simulado e o efeito em cada checkpoint.
 * Nenhum botão aqui grava, apaga ou atualiza nada.
 */
import { Card } from "@/components/page-header";
import { SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import type { FalseTransferDryRun } from "@/lib/bank-statements/false-transfer-repair";
import { formatCurrency } from "@/lib/finance";

function Snapshot({
  titulo,
  dados,
}: {
  titulo: string;
  dados: FalseTransferDryRun["antes"];
}) {
  return (
    <div className="rounded-2xl border border-border px-4 py-3">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{titulo}</p>
      <dl className="mt-2 space-y-1 text-sm">
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Movimentos</dt>
          <dd className="font-semibold">{dados.movimentos}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Entradas</dt>
          <dd className="font-semibold">{formatCurrency(dados.entradas)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Saídas</dt>
          <dd className="font-semibold">{formatCurrency(dados.saidas)}</dd>
        </div>
        <div className="flex justify-between gap-3">
          <dt className="text-muted-foreground">Saldo calculado</dt>
          <dd className="font-semibold">{formatCurrency(dados.saldoCalculado)}</dd>
        </div>
      </dl>
    </div>
  );
}

export function FalseTransferPanel({ plano }: { plano: FalseTransferDryRun }) {
  const tone =
    plano.status === "READY"
      ? plano.criterio.aprovado
        ? "ok"
        : "warn"
      : plano.status === "ABORT"
        ? "danger"
        : "muted";

  return (
    <Card className="mb-5">
      <SectionTitle
        title="Transferência falsa — simulação de remoção da contrapartida"
        hint="Somente leitura: nada é apagado nem atualizado. A perna real na conta de origem é sempre preservada."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={tone}>{plano.status}</StatusBadge>
        <p className="text-sm text-muted-foreground">{plano.resumoStatus}</p>
      </div>

      {plano.contrapartida && (
        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-2xl border border-destructive/50 bg-destructive/5 px-4 py-3">
            <StatusBadge tone="danger">REMOVER (simulado)</StatusBadge>
            <p className="mt-2 text-sm font-semibold">{plano.contrapartida.accountLabel}</p>
            <p className="text-sm">
              {plano.contrapartida.data} · {plano.contrapartida.direcao}{" "}
              {formatCurrency(plano.contrapartida.valor)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">{plano.contrapartida.descricao}</p>
            <p className="mt-2 font-mono text-[11px] text-muted-foreground">
              id {plano.contrapartida.transactionId}
              <br />
              grupo {plano.transferGroupId ?? "—"}
              <br />
              source {plano.contrapartida.sourceId ?? "—"} · item{" "}
              {plano.contrapartida.statementItemId ?? "—"}
            </p>
          </div>

          {plano.origem && (
            <div className="rounded-2xl border border-border bg-muted/30 px-4 py-3">
              <StatusBadge tone="ok">PRESERVAR</StatusBadge>
              <p className="mt-2 text-sm font-semibold">{plano.origem.accountLabel}</p>
              <p className="text-sm">
                {plano.origem.data} · {plano.origem.direcao} {formatCurrency(plano.origem.valor)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">{plano.origem.descricao}</p>
              <p className="mt-2 font-mono text-[11px] text-muted-foreground">
                id {plano.origem.transactionId}
                <br />
                conta {plano.origem.accountId ?? "—"}
              </p>
            </div>
          )}
        </div>
      )}

      {plano.checks.length > 0 && (
        <div className="mb-4 space-y-2">
          {plano.checks.map((c) => (
            <div
              key={c.id}
              className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border px-3 py-2"
            >
              <div>
                <p className="text-sm font-medium">{c.label}</p>
                <p className="text-xs text-muted-foreground">{c.detail}</p>
              </div>
              <StatusBadge tone={c.status === "PASS" ? "ok" : "danger"}>{c.status}</StatusBadge>
            </div>
          ))}
        </div>
      )}

      <div className="mb-4 grid gap-3 sm:grid-cols-2">
        <Snapshot titulo="Antes (ledger atual)" dados={plano.antes} />
        <Snapshot titulo="Depois (simulado)" dados={plano.depois} />
      </div>

      <div className="overflow-x-auto">
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
                <td className="py-2">
                  {c.data} <span className="text-xs text-muted-foreground">{c.tipo ?? ""}</span>
                </td>
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

      <div className="mt-4 rounded-2xl border border-border px-4 py-3 text-sm">
        <p className="font-semibold">Critério de conclusão</p>
        <ul className="mt-1 space-y-1 text-muted-foreground">
          <li>Documento (PDF): {plano.criterio.documentoMovimentos} movimentos</li>
          <li>
            Ledger simulado: {plano.criterio.ledgerSimulado} movimentos ·{" "}
            {plano.criterio.contagemConfere ? "confere" : "não confere"}
          </li>
          <li>
            Checkpoints com diferença zero:{" "}
            {plano.criterio.checkpointsConferem ? "todos" : `${plano.residuais.length} ainda divergem`}
          </li>
        </ul>
        {plano.residuais.length > 0 && (
          <p className="mt-2 text-xs text-muted-foreground">
            Divergência residual (outra causa, fora deste plano):{" "}
            {plano.residuais
              .map((r) => `${r.data} ${formatCurrency(r.diferencaDepois)}`)
              .join(" · ")}
          </p>
        )}
      </div>

      {plano.repairLog && (
        <pre className="mt-4 overflow-x-auto rounded-2xl bg-muted/40 p-4 text-[11px] leading-relaxed">
          {JSON.stringify(plano.repairLog, null, 2)}
        </pre>
      )}
    </Card>
  );
}
