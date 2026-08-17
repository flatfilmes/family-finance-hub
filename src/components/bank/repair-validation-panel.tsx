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

      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        Ledger encadeado — fechamento de um mês abre o mês seguinte
      </p>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Esta é a leitura oficial do impacto do reparo: uma linha perdida em um mês contamina todos
        os meses seguintes.
      </p>
      <div className="mb-6 overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-xs">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-semibold">Período</th>
              <th className="px-2 py-2 font-semibold">Abertura encadeada</th>
              <th className="px-2 py-2 font-semibold">Saldo antes do reparo</th>
              <th className="px-2 py-2 font-semibold">Saldo depois do reparo</th>
              <th className="px-2 py-2 font-semibold">Saldo do documento</th>
              <th className="px-2 py-2 font-semibold">Diferença antes → depois</th>
              <th className="px-2 py-2 font-semibold">Confere</th>
            </tr>
          </thead>
          <tbody>
            {v.chainedValidation.periodos.map((m) => (
              <tr key={m.importId} className="border-b border-border last:border-0">
                <td className="px-2 py-2 font-semibold">
                  {m.rotulo}
                  {m.origemDaDiferenca && (
                    <span className="ml-2 text-[10px] font-semibold text-destructive">origem</span>
                  )}
                </td>
                <td className="px-2 py-2">
                  {m.aberturaEncadeadaAntes === null
                    ? "—"
                    : formatCurrency(m.aberturaEncadeadaAntes)}
                </td>
                <td className="px-2 py-2">
                  {m.saldoAntesRepair === null ? "—" : formatCurrency(m.saldoAntesRepair)}
                </td>
                <td className="px-2 py-2 font-semibold">
                  {m.saldoDepoisRepair === null ? "—" : formatCurrency(m.saldoDepoisRepair)}
                </td>
                <td className="px-2 py-2">
                  {m.saldoDocumento === null ? "—" : formatCurrency(m.saldoDocumento)}
                </td>
                <td className="px-2 py-2">
                  <span className={m.confereAntes === false ? "font-semibold text-destructive" : ""}>
                    {m.differenceBefore === null ? "—" : formatCurrency(m.differenceBefore)}
                  </span>{" "}
                  →{" "}
                  <span className={m.confereDepois === false ? "font-semibold text-destructive" : ""}>
                    {m.differenceAfter === null ? "—" : formatCurrency(m.differenceAfter)}
                  </span>
                </td>
                <td className="px-2 py-2">
                  {m.confereDepois === null ? (
                    <span className="text-muted-foreground">sem saldo do documento</span>
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

      <p className="mb-1 text-xs font-semibold text-muted-foreground">
        Validação isolada por documento — leitura auxiliar
      </p>
      <p className="mb-2 text-[11px] text-muted-foreground">
        Cada mês começa no saldo inicial oficial do próprio PDF. Serve só para dizer se o documento
        fecha sozinho — não mede propagação e não é usada para liberar o reparo.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-xs">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-semibold">Período</th>
              <th className="px-2 py-2 font-semibold">Abertura oficial</th>
              <th className="px-2 py-2 font-semibold">Fechamento calculado</th>
              <th className="px-2 py-2 font-semibold">Saldo do documento</th>
              <th className="px-2 py-2 font-semibold">Diferença isolada</th>
            </tr>
          </thead>
          <tbody>
            {v.standaloneValidation.periodos.map((m) => (
              <tr key={m.importId} className="border-b border-border last:border-0">
                <td className="px-2 py-2 font-semibold">{m.rotulo}</td>
                <td className="px-2 py-2">
                  {m.aberturaOficial === null ? "—" : formatCurrency(m.aberturaOficial)}
                </td>
                <td className="px-2 py-2">
                  {m.saldoAntes === null ? "—" : formatCurrency(m.saldoAntes)}
                </td>
                <td className="px-2 py-2">
                  {m.saldoDocumento === null ? "—" : formatCurrency(m.saldoDocumento)}
                </td>
                <td className="px-2 py-2">
                  {m.diferencaAntes === null ? "—" : formatCurrency(m.diferencaAntes)}
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
