/**
 * RESULTADO DO DRY RUN DE VALIDAÇÃO — somente exibição.
 * Mostra a transação que nasceria de cada linha ausente e o diff de saldos
 * mês a mês. Nada aqui grava ou altera dado financeiro.
 */
import { Card } from "@/components/page-header";
import { SectionTitle, Metric } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { formatCurrency } from "@/lib/finance";
import type { RepairValidation } from "@/lib/bank-statements/repair-validation";

const VEREDITO_LABEL: Record<RepairValidation["veredito"], string> = {
  PRONTO_PARA_REPARO: "Dry run concluído — reparo comprovado",
  NADA_A_REPARAR: "Dry run concluído — nada a reparar",
  REVISAR: "Dry run concluído — revisar antes de reparar",
};

export function RepairValidationPanel({ v }: { v: RepairValidation }) {
  return (
    <Card className="mb-5">
      <SectionTitle
        title="Resultado do dry run de validação"
        hint="Simulação executada agora, em memória. Nenhuma transação foi criada, nenhum saldo foi alterado."
      />

      <div className="mb-4 flex flex-wrap items-center gap-2">
        <StatusBadge tone={v.veredito === "PRONTO_PARA_REPARO" ? "ok" : "warn"}>
          {VEREDITO_LABEL[v.veredito]}
        </StatusBadge>
        <StatusBadge tone="muted">Dry run · nada gravado</StatusBadge>
      </div>

      <div className="mb-5 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Transações que nasceriam" value={String(v.totais.seriamRestauradas)} />
        <Metric label="Descartadas na validação" value={String(v.totais.naoSeriamRestauradas)} />
        <Metric label="Efeito no saldo" value={formatCurrency(v.totais.efeitoSaldoFinal)} />
        <Metric
          label="Meses que passam a conferir"
          value={`${v.totais.mesesCorrigidos} · ${v.totais.mesesAindaDivergentes} ainda divergente(s)`}
        />
      </div>

      <p className="mb-2 text-xs font-semibold text-muted-foreground">
        Transação Y — o movimento exato que seria criado
      </p>
      {v.candidatos.length === 0 ? (
        <p className="mb-5 text-sm text-muted-foreground">
          Nenhuma linha ausente: não há transação a restaurar nesta conta.
        </p>
      ) : (
        <div className="mb-6 space-y-3">
          {v.candidatos.map((c) => (
            <div
              key={c.sourceId}
              className={`rounded-2xl border p-4 ${
                c.veredito === "SERIA_RESTAURADA"
                  ? "border-primary/40 bg-primary/5"
                  : "border-border bg-muted/30"
              }`}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2">
                <StatusBadge tone={c.veredito === "SERIA_RESTAURADA" ? "ok" : "warn"}>
                  {c.veredito === "SERIA_RESTAURADA"
                    ? "Seria restaurada"
                    : c.veredito === "JA_EXISTE_NO_LEDGER"
                      ? "Não seria restaurada — já existe"
                      : "Não seria restaurada — sem data"}
                </StatusBadge>
                <span className="text-xs text-muted-foreground">{c.periodo}</span>
                {c.documentNumber && (
                  <span className="font-mono text-[11px] text-muted-foreground">
                    doc {c.documentNumber}
                  </span>
                )}
              </div>

              <div className="overflow-x-auto">
                <table className="w-full min-w-[720px] text-left text-xs">
                  <tbody>
                    <Linha rotulo="Identificação" valor={c.preview.rotulo} mono />
                    <Linha rotulo="Data do movimento" valor={c.preview.data_movimento ?? "—"} />
                    <Linha
                      rotulo="Tipo e valor"
                      valor={`${c.preview.tipo} · ${formatCurrency(c.preview.valor)} (efeito ${formatCurrency(c.preview.efeitoSaldo)})`}
                    />
                    <Linha rotulo="Descrição" valor={c.preview.descricao} />
                    <Linha rotulo="Status" valor={c.preview.status} />
                    <Linha rotulo="source_id" valor={c.preview.source_id} mono />
                    <Linha rotulo="Item do extrato" valor={c.preview.statement_item_id} mono />
                    <Linha
                      rotulo="Já no ledger (mesmo dia/valor)"
                      valor={
                        c.irmaosNoLedger.length
                          ? c.irmaosNoLedger
                              .map(
                                (i) =>
                                  `${i.transactionId.slice(0, 8)}${i.documentNumber ? ` · doc ${i.documentNumber}` : ""}`,
                              )
                              .join(" · ")
                          : "—"
                      }
                      mono
                    />
                  </tbody>
                </table>
              </div>

              {c.rawText && (
                <p className="mt-2 font-mono text-[11px] text-muted-foreground">{c.rawText}</p>
              )}
              <p className="mt-2 text-xs text-muted-foreground">{c.explicacao}</p>
            </div>
          ))}
        </div>
      )}

      <p className="mb-2 text-xs font-semibold text-muted-foreground">
        Diff de saldos mês a mês — hoje vs. depois do reparo
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[820px] text-left text-xs">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-semibold">Mês</th>
              <th className="px-2 py-2 font-semibold">Movimentos</th>
              <th className="px-2 py-2 font-semibold">Saldo hoje</th>
              <th className="px-2 py-2 font-semibold">Saldo simulado</th>
              <th className="px-2 py-2 font-semibold">Saldo do banco</th>
              <th className="px-2 py-2 font-semibold">Diferença antes → depois</th>
              <th className="px-2 py-2 font-semibold">Confere</th>
            </tr>
          </thead>
          <tbody>
            {v.meses.map((m) => (
              <tr key={m.mes} className="border-b border-border last:border-0">
                <td className="px-2 py-2 font-semibold">{m.rotulo}</td>
                <td className="px-2 py-2">
                  {m.movimentosAntes} → {m.movimentosDepois}
                </td>
                <td className="px-2 py-2">{formatCurrency(m.saldoAntes)}</td>
                <td className="px-2 py-2 font-semibold">{formatCurrency(m.saldoDepois)}</td>
                <td className="px-2 py-2">
                  {m.saldoBanco === null ? "—" : formatCurrency(m.saldoBanco)}
                </td>
                <td className="px-2 py-2">
                  <span className={m.confereAntes === false ? "font-semibold text-destructive" : ""}>
                    {m.diferencaAntes === null ? "—" : formatCurrency(m.diferencaAntes)}
                  </span>{" "}
                  →{" "}
                  <span className={m.confereDepois === false ? "font-semibold text-destructive" : ""}>
                    {m.diferencaDepois === null ? "—" : formatCurrency(m.diferencaDepois)}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {m.confereDepois === null ? (
                    <span className="text-muted-foreground">sem saldo do banco</span>
                  ) : (
                    <StatusBadge tone={m.confereDepois ? "ok" : "warn"}>
                      {m.confereAntes ? "conferia" : "não conferia"} →{" "}
                      {m.confereDepois ? "confere" : "ainda diverge"}
                    </StatusBadge>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string; mono?: boolean }) {
  return (
    <tr className="border-b border-border/60 last:border-0">
      <td className="w-56 px-2 py-1.5 text-muted-foreground">{rotulo}</td>
      <td className={`px-2 py-1.5 ${mono ? "font-mono text-[11px]" : ""}`}>{valor}</td>
    </tr>
  );
}
