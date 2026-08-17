/**
 * PLANO DE REPARO DA PERSISTÊNCIA — tela somente leitura.
 *
 * Mostra, por período: quantos movimentos o documento tem, quantos existem
 * hoje no extrato do sistema, quais linhas exatas voltariam (com sourceId) e
 * qual saldo final o período passaria a ter. Nenhuma gravação acontece aqui.
 */
import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useQueryClient } from "@tanstack/react-query";
import { Download, FileJson, ShieldCheck, Wrench } from "lucide-react";
import {
  applyPersistenceRepair,
  evaluateRepairGate,
  type RepairOutcome,
} from "@/lib/bank-statements/repair-apply";
import { RepairResultPanel } from "@/components/bank/repair-result-panel";


import { Card } from "@/components/page-header";
import { DetailHeader, Metric, SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { NoFamily } from "@/components/no-family";
import { useFamily } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { useBankStatementImports, useBankStatementItems } from "@/hooks/useBankStatements";
import { useBankBalanceCheckpoints } from "@/hooks/useBankLedger";
import { buildAccountLineage } from "@/lib/bank-statements/lineage";
import {
  buildPersistenceRepairPlan,
  repairPlanToCsv,
  type RepairPeriod,
} from "@/lib/bank-statements/persistence-repair";
import { buildRepairProof } from "@/lib/bank-statements/repair-proof";
import { RepairProofPanel } from "@/components/bank/repair-proof-panel";
import { buildRepairValidation, type RepairValidation } from "@/lib/bank-statements/repair-validation";
import { RepairValidationPanel } from "@/components/bank/repair-validation-panel";
import { buildRepairPrecondition } from "@/lib/bank-statements/repair-precondition";
import { RepairPreconditionPanel } from "@/components/bank/repair-precondition-panel";
import { formatCurrency } from "@/lib/finance";


export const Route = createFileRoute("/_authenticated/bancos_/$accountId/plano-reparo")({
  head: () => ({
    meta: [
      { title: "Plano de reparo da persistência — Família Finance AI" },
      {
        name: "description",
        content:
          "Simulação somente leitura: quais lançamentos do extrato voltariam, em que data, e como o saldo de cada período mudaria.",
      },
      { property: "og:title", content: "Plano de reparo da persistência" },
      {
        property: "og:description",
        content: "Veja exatamente qual movimento foi perdido depois do parser e o efeito no saldo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: PlanoReparoPage,
});

function PlanoReparoPage() {
  const { accountId } = Route.useParams();
  const { data: family } = useFamily();
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: transactions } = useTransactions(family?.id);
  const { data: imports } = useBankStatementImports(accountId);
  const { data: items } = useBankStatementItems(accountId);
  const { data: checkpoints } = useBankBalanceCheckpoints(accountId);

  const conta = (accounts ?? []).find((a) => a.id === accountId) ?? null;

  const [validacao, setValidacao] = useState<RepairValidation | null>(null);
  const [resultado, setResultado] = useState<RepairOutcome | null>(null);
  const [aplicando, setAplicando] = useState(false);
  const [erro, setErro] = useState<string | null>(null);
  const queryClient = useQueryClient();
  const gate = evaluateRepairGate(validacao);

  async function aplicar() {
    if (!gate.habilitado || !gate.candidato || !family) return;
    setErro(null);
    setAplicando(true);
    try {
      const r = await applyPersistenceRepair({
        accountId,
        familyId: family.id,
        candidato: gate.candidato,
      });
      setResultado(r);
      setValidacao(null);
      for (const key of ["transactions", "bank-accounts", "bank-statement-items"]) {
        void queryClient.invalidateQueries({ queryKey: [key] });
      }
      void queryClient.invalidateQueries({ queryKey: ["bank-balance-checkpoints", accountId] });
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível aplicar o reparo.");
    } finally {
      setAplicando(false);
    }
  }


  const { plan, proof } = useMemo(() => {
    const lineages = buildAccountLineage({
      imports: imports ?? [],
      items: items ?? [],
      transactions: (transactions ?? []).filter((t) => t.bank_account_id === accountId),
      checkpoints: checkpoints ?? [],
    });
    const p = buildPersistenceRepairPlan({
      accountId,
      lineages,
      imports: imports ?? [],
      items: items ?? [],
      transactions: transactions ?? [],
      allTransactions: transactions ?? [],
      checkpoints: checkpoints ?? [],
    });
    return { plan: p, proof: buildRepairProof({ lineages, plan: p }) };
  }, [accountId, imports, items, transactions, checkpoints]);


  if (!family) return <NoFamily />;
  if (!conta) {
    return (
      <div>
        <Card>
          <p className="text-sm text-muted-foreground">
            Esta conta não existe ou não está disponível para o seu perfil.
          </p>
        </Card>
      </div>
    );
  }

  const base = `plano-reparo-${conta.nome_conta.replace(/\s+/g, "-").toLowerCase()}`;

  function baixar(conteudo: string, nome: string, tipo: string) {
    const blob = new Blob([conteudo], { type: tipo });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = nome;
    a.click();
    URL.revokeObjectURL(url);
  }

  const t = plan.totais;
  const comPerda = plan.periodos.filter((p) => p.restauradas.length);

  return (
    <div>
      <DetailHeader
        backTo="/bancos/$accountId"
        backParams={{ accountId }}
        backLabel="Voltar para a conta"
        title="Plano de reparo da persistência"
        subtitle={`${conta.banco} · ${conta.nome_conta} — simulação do que aconteceria se as linhas perdidas depois do parser voltassem`}
        badges={
          <>
            <StatusBadge tone="muted">Somente leitura — nada é gravado</StatusBadge>
            <StatusBadge tone={t.linhasRestauradas ? "danger" : "ok"}>
              {t.linhasRestauradas
                ? `${t.linhasRestauradas} movimento(s) a restaurar`
                : "Nenhum movimento perdido"}
            </StatusBadge>
          </>
        }
        actions={
          <div className="flex flex-wrap gap-2">
            <button
              onClick={() => baixar(repairPlanToCsv(plan), `${base}.csv`, "text/csv;charset=utf-8;")}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted"
            >
              <Download className="size-3.5" /> Exportar CSV
            </button>
            <button
              onClick={() =>
                baixar(JSON.stringify(plan, null, 2), `${base}.json`, "application/json")
              }
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted"
            >
              <FileJson className="size-3.5" /> Exportar JSON
            </button>
          </div>
        }
      />

      <Card className="mb-5">
        <SectionTitle
          title="Efeito total da simulação"
          hint="Comparação entre o que o extrato do sistema tem hoje e o que teria se cada linha perdida voltasse com a data e o valor originais do documento."
        />
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <Metric label="Movimentos no documento" value={String(t.movimentosDocumento)} />
          <Metric
            label="Movimentos hoje → simulado"
            value={`${t.movimentosAntes} → ${t.movimentosDepois}`}
          />
          <Metric label="Efeito no saldo atual" value={formatCurrency(t.deltaSaldoAtual)} />
          <Metric
            label="Metadados pendentes"
            value={`${t.importsSemSnapshot} retratos · ${t.linhasSemIdentidade} linhas · ${t.checkpointsSemTipo} saldos`}
          />
        </div>
      </Card>

      <RepairProofPanel proof={proof} />

      <Card className="mb-5 border-primary/30 bg-primary/5">
        <SectionTitle
          title="Validação e execução do reparo"
          hint="Validar apenas confere a prova acima. Aplicar só fica disponível quando o dry run passa e cria exatamente uma movimentação, reconferindo a pré-condição no instante do clique."
        />
        <div className="flex flex-wrap items-center gap-3">
          <button
            onClick={() => {
              setResultado(null);
              setValidacao(
                buildRepairValidation({
                  accountId,
                  plan,
                  proof,
                  transactions: transactions ?? [],
                  checkpoints: checkpoints ?? [],
                }),
              );
            }}
            className="inline-flex items-center gap-1.5 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground transition-opacity hover:opacity-90"
          >
            <ShieldCheck className="size-3.5" /> Validar reparo
          </button>
          <button
            disabled={!gate.habilitado || aplicando}
            title={gate.habilitado ? "Cria exatamente uma movimentação" : gate.motivos.join(" ")}
            onClick={aplicar}
            className={
              gate.habilitado && !aplicando
                ? "inline-flex items-center gap-1.5 rounded-full bg-destructive px-5 py-2 text-xs font-semibold text-destructive-foreground transition-opacity hover:opacity-90"
                : "inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-border px-5 py-2 text-xs font-semibold text-muted-foreground opacity-60"
            }
          >
            <Wrench className="size-3.5" /> {aplicando ? "Aplicando…" : "Aplicar reparo"}
          </button>
          {validacao && (
            <>
              <StatusBadge tone={validacao.validationRepair === "PASS" ? "ok" : "warn"}>
                VALIDATION_REPAIR = {validacao.validationRepair} ·{" "}
                {validacao.totais.restoreCount} transação(ões) a criar · efeito{" "}
                {formatCurrency(validacao.totais.efeitoSaldoFinal)}
              </StatusBadge>
              {precondicao && (
                <StatusBadge tone={precondicao.repairPrecondition === "PASS" ? "ok" : "danger"}>
                  REPAIR_PRECONDITION = {precondicao.repairPrecondition}
                </StatusBadge>
              )}
              <button
                onClick={() =>
                  baixar(
                    JSON.stringify(
                      { validacao, precondicao },
                      null,
                      2,
                    ),
                    `${base}-validacao.json`,
                    "application/json",
                  )
                }
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted"
              >
                <FileJson className="size-3.5" /> Exportar dry run
              </button>
            </>
          )}
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {gate.habilitado
            ? "Liberado: um clique cria uma única movimentação e reconfere todos os meses logo depois."
            : gate.motivos.join(" ")}
        </p>
        {erro && <p className="mt-2 text-xs font-semibold text-destructive">{erro}</p>}
      </Card>

      {resultado && <RepairResultPanel r={resultado} />}

      {precondicao && <RepairPreconditionPanel pc={precondicao} />}

      {validacao && <RepairValidationPanel v={validacao} />}




      <Card className="mb-5">
        <SectionTitle
          title="Períodos com movimento perdido"
          hint="Cada linha aqui é um lançamento que o documento traz e que não chegou ao extrato do sistema. O sourceId identifica exatamente qual linha voltaria."
        />
        {comPerda.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nenhum período desta conta perdeu movimento depois do parser.
          </p>
        ) : (
          <div className="space-y-4">
            {comPerda.map((p) => (
              <PeriodoBlock key={p.importId} p={p} />
            ))}
          </div>
        )}
      </Card>

      <Card className="mb-5">
        <SectionTitle
          title="Todos os períodos — movimentos e saldo final"
          hint="Antes é o que existe hoje. Depois é a simulação. A coluna diferença compara com o saldo final impresso no documento."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[880px] text-left text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-semibold">Período</th>
                <th className="px-2 py-2 font-semibold">Documento</th>
                <th className="px-2 py-2 font-semibold">Movimentos</th>
                <th className="px-2 py-2 font-semibold">Saldo final documento</th>
                <th className="px-2 py-2 font-semibold">Saldo antes → depois</th>
                <th className="px-2 py-2 font-semibold">Diferença antes → depois</th>
                <th className="px-2 py-2 font-semibold">Saldos conferidos</th>
              </tr>
            </thead>
            <tbody>
              {plan.periodos.map((p) => (
                <tr key={p.importId} className="border-b border-border last:border-0">
                  <td className="px-2 py-2 font-semibold">{p.rotulo}</td>
                  <td className="max-w-56 truncate px-2 py-2 text-muted-foreground">
                    {p.nomeArquivo}
                  </td>
                  <td className="px-2 py-2">
                    {p.movimentosDocumento} · {p.movimentosAntes} → {p.movimentosDepois}
                  </td>
                  <td className="px-2 py-2">
                    {p.saldoDocumento === null ? "—" : formatCurrency(p.saldoDocumento)}
                  </td>
                  <td className="px-2 py-2">
                    {p.saldoAntes === null ? "—" : formatCurrency(p.saldoAntes)} →{" "}
                    {p.saldoDepois === null ? "—" : formatCurrency(p.saldoDepois)}
                  </td>
                  <td className="px-2 py-2">
                    <span className={p.diferencaAntes ? "font-semibold text-destructive" : ""}>
                      {p.diferencaAntes === null ? "—" : formatCurrency(p.diferencaAntes)}
                    </span>{" "}
                    →{" "}
                    <span className={p.diferencaDepois ? "font-semibold text-destructive" : ""}>
                      {p.diferencaDepois === null ? "—" : formatCurrency(p.diferencaDepois)}
                    </span>
                  </td>
                  <td className="px-2 py-2">
                    {p.checkpointsConferemAntes} → {p.checkpointsConferemDepois} de{" "}
                    {p.checkpoints.length}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card className="mb-5">
        <SectionTitle
          title="Transferências automáticas e sua prova"
          hint="Uma transferência só é legítima quando existe o movimento oposto em outra conta. Sem contrapartida, não é perda de dinheiro — é classificação a revisar."
        />
        {plan.periodos.every((p) => !p.transferencias.length) ? (
          <p className="text-sm text-muted-foreground">
            Nenhum lançamento desta conta virou transferência automática.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[860px] text-left text-xs">
              <thead className="border-b border-border text-muted-foreground">
                <tr>
                  <th className="px-2 py-2 font-semibold">Período</th>
                  <th className="px-2 py-2 font-semibold">Data</th>
                  <th className="px-2 py-2 font-semibold">Descrição</th>
                  <th className="px-2 py-2 font-semibold">Valor</th>
                  <th className="px-2 py-2 font-semibold">Contrapartida</th>
                  <th className="px-2 py-2 font-semibold">Veredito</th>
                </tr>
              </thead>
              <tbody>
                {plan.periodos.flatMap((p) =>
                  p.transferencias.map((tr) => (
                    <tr key={tr.itemId} className="border-b border-border last:border-0">
                      <td className="px-2 py-2">{p.rotulo}</td>
                      <td className="px-2 py-2">{tr.data ?? "—"}</td>
                      <td className="max-w-64 truncate px-2 py-2">{tr.descricao}</td>
                      <td className="px-2 py-2">{formatCurrency(tr.valor)}</td>
                      <td className="px-2 py-2 font-mono text-[11px]">
                        {tr.contrapartida
                          ? `${tr.contrapartida.data} · ${tr.contrapartida.transactionId.slice(0, 8)}`
                          : "—"}
                      </td>
                      <td className="px-2 py-2">
                        <StatusBadge tone={tr.veredito === "COMPROVADA" ? "ok" : "warn"}>
                          {tr.veredito === "COMPROVADA"
                            ? "Comprovada — sem perda"
                            : "Sem contrapartida"}
                        </StatusBadge>
                      </td>
                    </tr>
                  )),
                )}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Card>
        <SectionTitle
          title="Backfill de metadados — impacto financeiro zero"
          hint="Retrato canônico do documento, identidade de linha e tipo de saldo. Nada disso altera valor, data ou saldo."
        />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-xs">
            <thead className="border-b border-border text-muted-foreground">
              <tr>
                <th className="px-2 py-2 font-semibold">Período</th>
                <th className="px-2 py-2 font-semibold">Arquivo</th>
                <th className="px-2 py-2 font-semibold">Retrato canônico</th>
                <th className="px-2 py-2 font-semibold">Linhas sem identidade</th>
                <th className="px-2 py-2 font-semibold">Saldos sem tipo</th>
                <th className="px-2 py-2 font-semibold">O que seria feito</th>
              </tr>
            </thead>
            <tbody>
              {plan.metadados.map((m) => (
                <tr key={m.importId} className="border-b border-border align-top last:border-0">
                  <td className="px-2 py-2 font-semibold">{m.periodo}</td>
                  <td className="max-w-56 truncate px-2 py-2 text-muted-foreground">
                    {m.nomeArquivo}
                  </td>
                  <td className="px-2 py-2">
                    <StatusBadge tone={m.snapshotCanonico ? "ok" : "warn"}>
                      {m.snapshotCanonico ? "Presente" : "Ausente"}
                    </StatusBadge>
                  </td>
                  <td className="px-2 py-2">
                    {m.linhasSemIdentidade}/{m.linhas}
                  </td>
                  <td className="px-2 py-2">
                    {m.checkpointsSemTipo}/{m.checkpoints}
                  </td>
                  <td className="px-2 py-2 text-muted-foreground">
                    {m.acoes.length ? m.acoes.join(" · ") : "Nada pendente"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
}

function PeriodoBlock({ p }: { p: RepairPeriod }) {
  return (
    <div className="rounded-2xl border border-border px-4 py-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold">
            {p.rotulo} · {p.movimentosAntes} → {p.movimentosDepois} movimentos
          </p>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Saldo final {p.saldoAntes === null ? "—" : formatCurrency(p.saldoAntes)} →{" "}
            {p.saldoDepois === null ? "—" : formatCurrency(p.saldoDepois)} · documento{" "}
            {p.saldoDocumento === null ? "—" : formatCurrency(p.saldoDocumento)} · diferença{" "}
            {p.diferencaAntes === null ? "—" : formatCurrency(p.diferencaAntes)} →{" "}
            {p.diferencaDepois === null ? "—" : formatCurrency(p.diferencaDepois)}
          </p>
        </div>
        <StatusBadge tone={p.diferencaDepois === 0 ? "ok" : "warn"}>
          {p.diferencaDepois === 0 ? "Fecha com o documento" : "Ainda diverge"}
        </StatusBadge>
      </div>

      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[900px] text-left text-xs">
          <thead className="border-b border-border text-muted-foreground">
            <tr>
              <th className="px-2 py-2 font-semibold">sourceId</th>
              <th className="px-2 py-2 font-semibold">Item</th>
              <th className="px-2 py-2 font-semibold">Data</th>
              <th className="px-2 py-2 font-semibold">Descrição</th>
              <th className="px-2 py-2 font-semibold">Valor</th>
              <th className="px-2 py-2 font-semibold">Efeito no saldo</th>
              <th className="px-2 py-2 font-semibold">Por que sumiu</th>
            </tr>
          </thead>
          <tbody>
            {p.restauradas.map((r) => (
              <tr key={r.itemId} className="border-b border-border align-top last:border-0">
                <td className="px-2 py-2 font-mono">{r.sourceId}</td>
                <td className="px-2 py-2 font-mono text-[11px]">{r.itemId.slice(0, 8)}</td>
                <td className="px-2 py-2">{r.data ?? "—"}</td>
                <td className="max-w-64 px-2 py-2">{r.descricao}</td>
                <td className="px-2 py-2">{formatCurrency(r.valor)}</td>
                <td className="px-2 py-2 font-semibold">{formatCurrency(r.deltaSaldo)}</td>
                <td className="max-w-80 px-2 py-2 text-muted-foreground">
                  {r.reviewAction}/{r.matchStatus} — {r.motivo}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
