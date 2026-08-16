import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { AlertTriangle, Check, ChevronDown, Download } from "lucide-react";

import { Card } from "@/components/page-header";
import { DetailHeader, Metric, SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { NoFamily } from "@/components/no-family";
import { useFamily } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { usePurchases } from "@/hooks/usePurchases";
import { useCardInvoices } from "@/hooks/useCardInvoices";
import { useBankStatementImports, useBankStatementItems } from "@/hooks/useBankStatements";
import { useBankBalanceCheckpoints } from "@/hooks/useBankLedger";
import { ReprocessCheckpointsDialog } from "@/components/bank/reprocess-checkpoints-dialog";
import { RepairHistoryDialog } from "@/components/bank/repair-history-dialog";
import { CheckpointsOnlyButton } from "@/components/bank/checkpoints-only-button";
import {
  auditToCsv,
  buildBankAudit,
  ISSUE_CATEGORY_LABELS,
  MONTH_STATUS_LABELS,
  MONTH_STATUS_TONES,
  SEVERITY_LABELS,
  SEVERITY_TONES,
  type AuditMonth,
} from "@/lib/bank-audit";
import { formatCurrency } from "@/lib/finance";
import { formatDate, monthLabel } from "@/lib/expenses";

export const Route = createFileRoute("/_authenticated/bancos_/$accountId/auditoria")({
  head: () => ({
    meta: [
      { title: "Auditoria da conta — Família Finance AI" },
      {
        name: "description",
        content:
          "Relatório de auditoria da conta bancária: continuidade dos extratos, saldos mensais e diários, duplicidades, lacunas e pendências de classificação.",
      },
      { property: "og:title", content: "Auditoria da conta — Família Finance AI" },
      {
        property: "og:description",
        content: "Descubra em qual mês, dia e valor existe furo no extrato importado.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: AuditoriaContaPage,
});

function AuditoriaContaPage() {
  const { accountId } = Route.useParams();
  const { data: family } = useFamily();
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: transactions } = useTransactions(family?.id);
  const { data: purchases } = usePurchases(family?.id);
  const { data: invoices } = useCardInvoices(family?.id);
  const { data: imports } = useBankStatementImports(accountId);
  const { data: statementItems } = useBankStatementItems(accountId);
  const { data: checkpoints } = useBankBalanceCheckpoints(accountId);
  const [mesAberto, setMesAberto] = useState<string | null>(null);
  const [diasAbertos, setDiasAbertos] = useState<Record<string, boolean>>({});

  const conta = (accounts ?? []).find((a) => a.id === accountId) ?? null;

  const audit = useMemo(
    () =>
      buildBankAudit({
        accountId,
        transactions: transactions ?? [],
        imports: imports ?? [],
        checkpoints: checkpoints ?? [],
        statementItems: statementItems ?? [],
        purchases: purchases ?? [],
        cardInvoiceIds: (invoices ?? []).map((i) => i.id),
        accounts: accounts ?? [],
        saldoReferencia: conta
          ? {
              saldo: Number(conta.saldo_atual) || 0,
              data: String(conta.updated_at).slice(0, 10),
            }
          : null,
      }),
    [
      accountId,
      transactions,
      imports,
      checkpoints,
      statementItems,
      purchases,
      invoices,
      accounts,
      conta,
    ],
  );

  if (!family) return <NoFamily />;

  if (!conta) {
    return (
      <div>
        <DetailHeader backTo="/bancos" backLabel="Voltar para Bancos" title="Conta não encontrada" />
        <Card>
          <p className="text-sm text-muted-foreground">
            Esta conta não existe ou não está disponível para o seu perfil.
          </p>
        </Card>
      </div>
    );
  }

  const r = audit.resumo;

  function exportarCsv() {
    const blob = new Blob([auditToCsv(audit)], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `auditoria-${conta!.nome_conta.replace(/\s+/g, "-").toLowerCase()}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div>
      <DetailHeader
        backTo="/bancos/$accountId"
        backParams={{ accountId }}
        backLabel="Voltar para a conta"
        title="Auditoria da conta"
        subtitle={`${conta.banco} · ${conta.nome_conta}${
          audit.periodoInicio && audit.periodoFim
            ? ` · ${monthLabel(audit.periodoInicio.slice(0, 7))} → ${monthLabel(
                audit.periodoFim.slice(0, 7),
              )}`
            : ""
        }`}
        badges={<StatusBadge tone="muted">Somente leitura — nada é alterado</StatusBadge>}
        actions={
          <div className="flex flex-wrap gap-2">
            <RepairHistoryDialog accountId={accountId} imports={imports ?? []} />
            <CheckpointsOnlyButton accountId={accountId} />
            <ReprocessCheckpointsDialog accountId={accountId} familyId={family.id} />
            <button
              onClick={exportarCsv}
              className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-2 text-xs font-semibold transition-colors hover:bg-muted"
            >
              <Download className="size-3.5" /> Exportar relatório
            </button>
          </div>
        }
      />

      {/* ---------- problemas encontrados ---------- */}
      {(["FINANCEIRA", "DADOS"] as const).map((categoria) => {
        const lista = audit.problemas
          .filter((p) => p.categoria === categoria)
          .sort(
            (a, b) =>
              ordemSeveridade(a.severity) - ordemSeveridade(b.severity) ||
              a.titulo.localeCompare(b.titulo),
          );
        return (
          <Card key={categoria} className="mb-5">
            <SectionTitle
              title={ISSUE_CATEGORY_LABELS[categoria]}
              hint={
                categoria === "FINANCEIRA"
                  ? "Movimentos, checkpoints, saldo e continuidade — é isso que valida ou invalida um mês."
                  : "Associação, categoria e identificação de origem. São pendências operacionais: não invalidam o saldo."
              }
            />
            {lista.length === 0 ? (
              <p className="flex items-center gap-2 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
                <Check className="size-4" />{" "}
                {categoria === "FINANCEIRA"
                  ? "Nenhum problema de saldo encontrado."
                  : "Nenhuma pendência de qualidade de dados."}
              </p>
            ) : (
              <ol className="space-y-2">
                {lista.map((p) => (
                  <li
                    key={p.id}
                    className="flex flex-wrap items-start gap-3 rounded-2xl border border-border px-4 py-3"
                  >
                    <StatusBadge tone={SEVERITY_TONES[p.severity]}>
                      {SEVERITY_LABELS[p.severity]}
                    </StatusBadge>
                    <div className="min-w-0 flex-1">
                      <p className="text-sm font-semibold">{p.titulo}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">{p.detalhe}</p>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </Card>
        );
      })}

      {/* ---------- resumo geral ---------- */}
      <div className="mb-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <Metric label="Extratos importados" value={String(r.extratos)} />
        <Metric
          label="Meses validados"
          value={`${r.mesesValidadosCompletos} / ${r.totalMeses}`}
          hint={`Conferidos dia a dia · ${r.mesesValidados - r.mesesValidadosCompletos} fecham só no mês`}
          {...(r.mesesValidadosCompletos === r.totalMeses && r.totalMeses
            ? { tone: "ok" as const }
            : {})}
        />
        <Metric
          label="Meses com continuidade"
          value={`${r.mesesComContinuidade} / ${r.totalTransicoes}`}
          hint="Transições entre extratos consecutivos"
        />
        <Metric
          label="Meses sem checkpoint"
          value={String(r.mesesSemCheckpoint)}
          hint="Reprocesse o PDF para conferir dia a dia"
        />
        <Metric
          label="Movimentos PDF × ledger"
          value={`${r.movimentosPdf} / ${r.movimentosLedger}`}
          hint={r.faltantes ? `${r.faltantes} faltando no ledger` : "Nenhum faltando"}
          {...(r.faltantes ? { tone: "danger" as const } : {})}
        />
        <Metric
          label="Datas inconsistentes"
          value={String(r.datasInconsistentes)}
          hint="Ledger diferente da data do extrato"
          {...(r.datasInconsistentes ? { tone: "danger" as const } : {})}
        />
        <Metric
          label="Associações inválidas"
          value={String(r.associacoesInvalidas)}
          hint="Vínculos com movimentação de outro mês"
          {...(r.associacoesInvalidas ? { tone: "danger" as const } : {})}
        />
        <Metric
          label="Meses com divergência"
          value={String(r.mesesComDivergencia)}
          {...(r.mesesComDivergencia ? { tone: "danger" as const } : {})}
        />
        <Metric
          label="Dias com divergência"
          value={String(r.diasComDivergencia)}
          {...(r.diasComDivergencia ? { tone: "danger" as const } : {})}
        />
        <Metric label="Sem associação" value={String(r.semAssociacao)} />
        <Metric label="Sem categoria" value={String(r.semCategoria)} />
        <Metric
          label="Lacunas de período"
          value={String(r.lacunas)}
          hint={r.sobreposicoes ? `${r.sobreposicoes} sobreposição(ões)` : "Cobertura pelo período do extrato"}
        />
        <Metric label="Duplicidades" value={String(r.duplicidades)} />
      </div>

      {/* ---------- linha do tempo ---------- */}
      <Card className="mb-5">
        <SectionTitle
          title="Linha do tempo"
          hint="Situação específica de cada mês — nunca um alerta genérico."
        />
        <div className="flex flex-wrap gap-2">
          {audit.meses.map((m) => (
            <button
              key={m.key}
              onClick={() => setMesAberto(mesAberto === m.key ? null : m.key)}
              className="rounded-2xl border border-border px-3 py-2 text-left transition-colors hover:bg-muted"
            >
              <p className="text-[11px] font-semibold uppercase text-muted-foreground">
                {monthLabel(m.key)}
              </p>
              <StatusBadge tone={MONTH_STATUS_TONES[m.status]} className="mt-1">
                {MONTH_STATUS_LABELS[m.status]}
              </StatusBadge>
            </button>
          ))}
        </div>
      </Card>

      {/* ---------- continuidade ---------- */}
      <Card className="mb-5">
        <SectionTitle
          title="Continuidade entre extratos"
          hint="Saldo final de um extrato comparado com o saldo inicial do seguinte."
        />
        {audit.continuidade.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            É preciso pelo menos dois extratos importados para conferir a continuidade.
          </p>
        ) : (
          <ul className="space-y-2">
            {audit.continuidade.map((c) => (
              <li key={c.anterior.id} className="rounded-2xl border border-border px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <p className="text-sm font-semibold">
                    {monthLabel(String(c.anterior.inicio).slice(0, 7))} →{" "}
                    {monthLabel(String(c.proximo.inicio).slice(0, 7))}
                  </p>
                  <StatusBadge tone={c.confere ? "ok" : "danger"}>
                    {c.confere ? "Continuidade confirmada" : "Quebra de continuidade"}
                  </StatusBadge>
                </div>
                <div className="mt-2 grid gap-2 text-xs text-muted-foreground sm:grid-cols-3">
                  <span>
                    Fecha em <strong>{formatCurrency(c.saldoFinalAnterior ?? 0)}</strong>
                  </span>
                  <span>
                    Abre em <strong>{formatCurrency(c.saldoInicialProximo ?? 0)}</strong>
                  </span>
                  <span>
                    Diferença{" "}
                    <strong className={c.confere ? "" : "text-destructive"}>
                      {formatCurrency(c.diferenca ?? 0)}
                    </strong>
                  </span>
                </div>
                {!c.confere && (
                  <p className="mt-2 text-xs text-destructive">
                    Período provável do problema: entre o fechamento de{" "}
                    {formatDate(String(c.anterior.fim))} e a abertura de{" "}
                    {formatDate(String(c.proximo.inicio))}.
                  </p>
                )}
                {c.lacuna && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Lacuna: {formatDate(c.lacuna.inicio)} – {formatDate(c.lacuna.fim)} (
                    {c.lacuna.dias} dia(s)).{" "}
                    {c.confere
                      ? "Continuidade financeira preservada, mas sem detalhamento."
                      : "Faltam movimentações neste intervalo."}
                  </p>
                )}
                {c.sobreposicao && (
                  <p className="mt-2 text-xs text-amber-700 dark:text-amber-400">
                    Períodos sobrepostos — as movimentações não são contadas duas vezes na
                    auditoria.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- auditoria mensal ---------- */}
      <Card className="mb-5">
        <SectionTitle
          title="Auditoria mensal"
          hint="Saldo inicial informado pelo banco + entradas − saídas = saldo calculado."
        />
        <div className="space-y-2">
          {audit.meses.map((m) => (
            <MesCard
              key={m.key}
              mes={m}
              aberto={mesAberto === m.key}
              onToggle={() => setMesAberto(mesAberto === m.key ? null : m.key)}
              diasAbertos={!!diasAbertos[m.key]}
              onToggleDias={() =>
                setDiasAbertos((s) => ({ ...s, [m.key]: !s[m.key] }))
              }
            />
          ))}
        </div>
      </Card>

      {/* ---------- saldo de referência ---------- */}
      {audit.referenciaManual && (
        <Card className="mb-5">
          <SectionTitle
            title="Saldo de referência informado"
            hint="Comparado apenas com o saldo calculado na mesma data."
          />
          <div className="grid gap-3 sm:grid-cols-3">
            <Metric
              label="Saldo informado"
              value={formatCurrency(audit.referenciaManual.saldoInformado)}
              hint={formatDate(audit.referenciaManual.data)}
            />
            <Metric
              label="Saldo calculado"
              value={
                audit.referenciaManual.saldoCalculado === null
                  ? "—"
                  : formatCurrency(audit.referenciaManual.saldoCalculado)
              }
            />
            <Metric
              label="Diferença"
              value={
                audit.referenciaManual.diferenca === null
                  ? "—"
                  : formatCurrency(audit.referenciaManual.diferenca)
              }
              {...(audit.referenciaManual.diferenca &&
              Math.abs(audit.referenciaManual.diferenca) > 0.02
                ? { tone: "danger" as const }
                : {})}
            />
          </div>
          {!audit.referenciaManual.coberto && (
            <p className="mt-3 text-xs text-amber-700 dark:text-amber-400">
              Não é possível conferir ainda: faltam {audit.referenciaManual.diasFaltando} dia(s) de
              histórico importado.
            </p>
          )}
        </Card>
      )}

      {/* ---------- duplicidades ---------- */}
      <Card className="mb-5">
        <SectionTitle
          title="Possíveis duplicidades"
          hint="Mesma data, mesmo valor, mesmo sentido e mesma descrição."
        />
        {audit.duplicidades.length === 0 ? (
          <p className="text-sm text-muted-foreground">Nenhuma duplicidade encontrada.</p>
        ) : (
          <ul className="space-y-2">
            {audit.duplicidades.map((d) => (
              <li key={d.key} className="rounded-2xl border border-amber-500/40 px-4 py-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-sm font-semibold">
                    {formatDate(d.date)} · {d.descricao}
                  </p>
                  <span className="text-sm font-bold">{formatCurrency(d.valor)}</span>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {d.ids.length} lançamentos {d.direcao === "IN" ? "de entrada" : "de saída"}{" "}
                  idênticos.
                </p>
              </li>
            ))}
          </ul>
        )}
      </Card>

      {/* ---------- pendências ---------- */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <SectionTitle
            title="Sem associação"
            hint="Não impede o saldo de fechar — é pendência de classificação."
          />
          <ListaMovimentos itens={audit.semAssociacao} />
        </Card>
        <Card>
          <SectionTitle
            title="Sem categoria"
            hint="Financeiramente correto, apenas sem classificação de gasto."
          />
          <ListaMovimentos itens={audit.semCategoria} />
        </Card>
      </div>

      {(audit.pagamentosCartaoSemFatura.length > 0 ||
        audit.transferenciasProvaveis.length > 0) && (
        <Card className="mt-5">
          <SectionTitle title="Verificações adicionais" />
          {audit.pagamentosCartaoSemFatura.length > 0 && (
            <div className="mb-4">
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Pagamento de cartão sem fatura associada
              </p>
              <ul className="space-y-1.5">
                {audit.pagamentosCartaoSemFatura.map((t) => (
                  <li key={t.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">
                      {formatDate(t.data_movimento)} · {t.descricao}
                    </span>
                    <span className="font-semibold">{formatCurrency(Number(t.valor))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
          {audit.transferenciasProvaveis.length > 0 && (
            <div>
              <p className="mb-2 text-xs font-semibold uppercase text-muted-foreground">
                Possível transferência entre contas
              </p>
              <ul className="space-y-1.5">
                {audit.transferenciasProvaveis.map((t) => (
                  <li key={t.saida.id} className="flex items-center justify-between gap-3 text-sm">
                    <span className="truncate">
                      {formatDate(t.saida.data_movimento)} · saída equivalente à entrada em{" "}
                      {t.contaDestino}
                    </span>
                    <span className="font-semibold">{formatCurrency(Number(t.saida.valor))}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}
        </Card>
      )}
    </div>
  );
}

function ordemSeveridade(s: string) {
  return ["CRITICO", "ATENCAO", "PENDENCIA", "INFORMATIVO"].indexOf(s);
}

function MesCard({
  mes,
  aberto,
  onToggle,
  diasAbertos,
  onToggleDias,
}: {
  mes: AuditMonth;
  aberto: boolean;
  onToggle: () => void;
  diasAbertos: boolean;
  onToggleDias: () => void;
}) {
  return (
    <div className="rounded-2xl border border-border">
      <button
        onClick={onToggle}
        className="flex w-full flex-wrap items-center justify-between gap-3 px-4 py-3 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold">
          <ChevronDown
            className={`size-4 transition-transform ${aberto ? "rotate-180" : ""}`}
          />
          {monthLabel(mes.key)}
        </span>
        <span className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">
            PDF {mes.movimentosPdf} · ledger {mes.movimentosLedger}
          </span>
          <span className="text-sm font-bold">{formatCurrency(mes.calculated)}</span>
          <StatusBadge tone={MONTH_STATUS_TONES[mes.status]}>
            {MONTH_STATUS_LABELS[mes.status]}
          </StatusBadge>
        </span>
      </button>

      {aberto && (
        <div className="border-t border-border px-4 py-3">
          <div className="grid gap-2 text-sm sm:grid-cols-3 lg:grid-cols-6">
            <Linha label="Saldo inicial" valor={mes.openingBalance} />
            <Linha label="Entradas" valor={mes.inflows} />
            <Linha label="Saídas" valor={-mes.outflows} />
            <Linha label="Saldo calculado" valor={mes.calculated} />
            <Linha label="Banco informou" valor={mes.reported} />
            <Linha label="Diferença" valor={mes.difference} destaque={mes.confere === false} />
          </div>

          {mes.primeiraDivergencia && (
            <div className="mt-3 rounded-xl border border-red-500/40 bg-red-500/5 px-3 py-2">
              <p className="flex items-center gap-2 text-xs font-semibold text-destructive">
                <AlertTriangle className="size-3.5" />
                Primeira divergência em {formatDate(mes.primeiraDivergencia.date)}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Calculado {formatCurrency(mes.primeiraDivergencia.calculado)} · banco informou{" "}
                {formatCurrency(mes.primeiraDivergencia.informado)} · diferença{" "}
                {formatCurrency(mes.primeiraDivergencia.diferenca)}.{" "}
                {mes.primeiraDivergencia.ultimoDiaCorreto
                  ? `Último dia correto: ${formatDate(mes.primeiraDivergencia.ultimoDiaCorreto)}.`
                  : "Nenhum dia conferido antes deste."}{" "}
                {mes.primeiraDivergencia.movimentosDesdeUltimoCorreto.length} movimentação(ões) no
                intervalo suspeito.
              </p>
            </div>
          )}

          {mes.imports.length > 0 && mes.checkpoints === 0 && (
            <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              Este mês não tem "Saldo do dia" registrado. Use "Reprocessar checkpoints" para reler o
              PDF — nenhuma movimentação será alterada.
            </p>
          )}

          {mes.imports.length > 0 && mes.checkpoints > 0 && (
            <p className="mt-3 rounded-xl bg-muted px-3 py-2 text-xs text-muted-foreground">
              Saldos diários: {mes.checkpointsConferem} de {mes.checkpoints} conferidos
              {mes.checkpointsPdf ? ` · ${mes.checkpointsPdf} encontrados no PDF` : ""}.
            </p>
          )}


          {mes.faltantes.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold text-destructive">
                {mes.faltantes.length} movimentação(ões) do PDF sem correspondência no ledger
              </p>
              <ul className="space-y-1">
                {mes.faltantes.map((f) => (
                  <li key={f.itemId} className="flex justify-between gap-3 text-xs">
                    <span className="truncate">
                      {f.data ? formatDate(f.data) : "sem data"} · {f.descricao}
                    </span>
                    <span className="shrink-0 font-semibold">{formatCurrency(f.valor)}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mes.datasInconsistentes.length > 0 && (
            <div className="mt-3">
              <p className="mb-1.5 text-xs font-semibold text-amber-700 dark:text-amber-400">
                {mes.datasInconsistentes.length} movimentação(ões) com data diferente da do extrato
              </p>
              <ul className="space-y-1">
                {mes.datasInconsistentes.map((d) => (
                  <li key={d.itemId} className="text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">{d.descricao}</span> — extrato{" "}
                    {formatDate(String(d.dataExtrato))}, ledger {formatDate(d.dataLedger)}
                    {d.dataNoHistorico ? ` (histórico cita ${formatDate(d.dataNoHistorico)})` : ""}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {mes.missingAmount !== null && (
            <p className="mt-3 flex items-center gap-2 rounded-xl bg-red-500/10 px-3 py-2 text-xs font-semibold text-destructive">
              <AlertTriangle className="size-3.5" />
              Possível valor não identificado: {formatCurrency(mes.missingAmount)}
            </p>
          )}

          {mes.ajustes.length > 0 && (
            <p className="mt-3 text-xs text-muted-foreground">
              {mes.ajustes.length} lançamento(s) de abertura/ajuste de saldo neste mês não entram
              como entrada nem saída do período.
            </p>
          )}

          <button
            onClick={onToggleDias}
            className="mt-3 text-xs font-semibold text-primary hover:underline"
          >
            {diasAbertos ? "Ocultar dias" : `Ver dias (${mes.days.length})`}
          </button>

          {diasAbertos && (
            <ul className="mt-3 space-y-2">
              {mes.days.map((d) => (
                <li
                  key={d.date}
                  className={`rounded-xl border px-3 py-2 ${
                    d.confere === false ? "border-red-500/40 bg-red-500/5" : "border-border"
                  }`}
                >
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="text-sm font-semibold">{formatDate(d.date)}</span>
                    {d.confere !== null && (
                      <StatusBadge tone={d.confere ? "ok" : "danger"}>
                        {d.confere ? "Confere" : "Diferença"}
                      </StatusBadge>
                    )}
                  </div>
                  <div className="mt-1 grid gap-1 text-xs text-muted-foreground sm:grid-cols-5">
                    <span>Inicial {formatCurrency(d.openingBalance)}</span>
                    <span>Entradas {formatCurrency(d.inflows)}</span>
                    <span>Saídas {formatCurrency(d.outflows)}</span>
                    <span>Calculado {formatCurrency(d.calculated)}</span>
                    <span>
                      Banco {d.reported === null ? "—" : formatCurrency(d.reported)}
                    </span>
                  </div>
                  {d.confere === false && (
                    <p className="mt-1 text-xs font-semibold text-destructive">
                      Diferença de {formatCurrency(d.difference ?? 0)} — possível movimentação
                      ausente ou duplicada.
                    </p>
                  )}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function Linha({
  label,
  valor,
  destaque,
}: {
  label: string;
  valor: number | null;
  destaque?: boolean;
}) {
  return (
    <div>
      <p className="text-[11px] font-semibold text-muted-foreground">{label}</p>
      <p className={`text-sm font-bold ${destaque ? "text-destructive" : ""}`}>
        {valor === null ? "—" : formatCurrency(valor)}
      </p>
    </div>
  );
}

function ListaMovimentos({
  itens,
}: {
  itens: { transaction: { id: string; data_movimento: string; descricao: string; valor: number | string }; motivo: string }[];
}) {
  if (itens.length === 0) {
    return <p className="text-sm text-muted-foreground">Nada pendente por aqui.</p>;
  }
  return (
    <ul className="space-y-1.5">
      {itens.slice(0, 40).map((i) => (
        <li key={i.transaction.id} className="flex items-center justify-between gap-3 text-sm">
          <span className="truncate">
            {formatDate(i.transaction.data_movimento)} · {i.transaction.descricao}
          </span>
          <span className="shrink-0 font-semibold">
            {formatCurrency(Number(i.transaction.valor))}
          </span>
        </li>
      ))}
      {itens.length > 40 && (
        <li className="text-xs text-muted-foreground">
          e mais {itens.length - 40} movimentação(ões).
        </li>
      )}
    </ul>
  );
}
