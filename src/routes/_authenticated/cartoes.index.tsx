import { useState } from "react";
import { CreditCard, FileUp } from "lucide-react";
import { StatementImportDialog } from "@/components/statement-import-dialog";
import { competenciaImportacao } from "@/components/card-statement-imports";
import { useStatementImports } from "@/hooks/useCardStatements";
import { IMPORT_STATUS_LABELS, type StatementImport } from "@/lib/card-statements";
import { StatusBadge } from "@/components/status-badge";
import { SearchInput, matchesSearch } from "@/components/search-input";
import { EmptyState } from "@/components/empty-state";
import { TONE_DOTS, usageTone } from "@/lib/status";

import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { Badge, Metric } from "@/components/detail-page";
import { useFamily } from "@/hooks/useFamilyData";
import { useCardsData } from "@/hooks/useCardsData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useMemberName } from "@/components/member-select";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { useStickyState } from "@/hooks/useStickyState";
import { formatDate } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";
import { NoFamily } from "@/components/no-family";

export const Route = createFileRoute("/_authenticated/cartoes/")({
  head: () => ({
    meta: [
      { title: "Cartões da Família — Família Finance AI" },
      {
        name: "description",
        content:
          "Painel de crédito da família: faturas abertas, limites, capacidade de pagamento e próximas faturas.",
      },
      { property: "og:title", content: "Cartões da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Faturas, limite utilizado, histórico e pagamento das faturas dos cartões.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CartoesPage,
});

function CartoesPage() {
  const { data: family } = useFamily();
  const dados = useCardsData(family?.id);
  const { data: accounts } = useBankAccounts(family?.id);
  const memberName = useMemberName(family?.id);
  const view = useViewMode();

  const [filtroMembro, setFiltroMembro] = useStickyState("cartoes:membro", "");
  const [filtroBanco, setFiltroBanco] = useStickyState("cartoes:banco", "");
  const [mes, setMes] = useStickyState("cartoes:mes", "");
  const [busca, setBusca] = useStickyState("cartoes:busca", "");
  const [importando, setImportando] = useState(false);
  const importacoes = useStatementImports(family?.id);

  if (!family) return <NoFamily />;

  const bancos = Array.from(new Set(dados.cards.map((c) => c.banco))).sort();

  // Resumo: apenas a última importação de cada cartão (a lista completa vive no cartão).
  const ultimasPorCartao = dados.cards
    .map((cartao) => ({
      cartao,
      imp: (importacoes.data ?? []).find((i) => i.credit_card_id === cartao.id),
    }))
    .filter((r): r is { cartao: (typeof dados.cards)[number]; imp: StatementImport } => !!r.imp);


  const lista = filterByMember(dados.cards, view.scoped(filtroMembro)).filter(
    (c) =>
      (filtroBanco ? c.banco === filtroBanco : true) &&
      matchesSearch(busca, c.banco, c.nome_cartao, memberName(c.member_id)),
  );
  const temFiltro = Boolean(busca || filtroBanco || mes || filtroMembro);

  const visiveis = lista.filter((c) => {
    if (!mes) return true;
    const venc = dados.info(c.id)?.proximoVencimento;
    return !!venc && venc.startsWith(mes);
  });

  const contasAtivas = filterByMember(accounts ?? [], view.scoped(filtroMembro)).filter(
    (a) => a.ativo,
  );

  const totalLimite = visiveis
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const totalFaturasAbertas = visiveis.reduce((acc, c) => {
    const fatura = dados.info(c.id)?.faturaAtual;
    return acc + (fatura && fatura.status !== "PAGA" ? Number(fatura.valor_total) || 0 : 0);
  }, 0);
  const totalUtilizado = visiveis.reduce((acc, c) => acc + dados.utilizadoDe(c.id), 0);
  const saldoContas = contasAtivas.reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const capacidade = saldoContas - totalFaturasAbertas;
  const statusPagamento =
    capacidade < 0 ? "vermelho" : capacidade < totalFaturasAbertas * 0.2 ? "amarelo" : "verde";
  const statusTexto = {
    verde: "Saldo em contas cobre as faturas abertas com folga.",
    amarelo: "Saldo cobre as faturas, mas com margem pequena.",
    vermelho: "Saldo disponível não cobre todas as faturas abertas.",
  }[statusPagamento];
  const statusTone = ({ verde: "ok", amarelo: "warn", vermelho: "danger" } as const)[
    statusPagamento
  ];

  return (
    <div>
      <PageHeader
        title="Cartões da família"
        subtitle="Visão geral do crédito. Clique em um cartão para abrir a página completa com fatura, lançamentos e projeções."
      />

      <div className="-mt-4 mb-6 flex flex-wrap items-center gap-3">
        <PrimaryButton type="button" onClick={() => setImportando(true)}>
          <span className="inline-flex items-center gap-2">
            <FileUp className="size-4" /> Importar fatura
          </span>
        </PrimaryButton>
        <p className="text-xs text-muted-foreground">
          Envie a fatura em PDF para conferir com as compras já cadastradas ou para criar os
          lançamentos que faltam.
        </p>
      </div>

      {importando && (
        <StatementImportDialog cards={dados.cards} onClose={() => setImportando(false)} />
      )}

      {ultimasPorCartao.length > 0 && (
        <Card className="mb-4">
          <p className="text-base font-bold">Últimas importações</p>
          <p className="text-xs text-muted-foreground">
            Um resumo por cartão. A lista completa fica dentro de cada cartão.
          </p>
          <ul className="mt-2 divide-y divide-border">
            {ultimasPorCartao.map(({ cartao, imp }) => (
              <li key={cartao.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {cartao.banco} · {cartao.nome_cartao}
                  </p>
                  <p className="truncate text-xs text-muted-foreground">
                    Fatura {competenciaImportacao(imp)} ·{" "}
                    {formatCurrency(Number(imp.valor_total_fatura) || 0)}
                    {imp.data_vencimento ? ` · vence em ${formatDate(imp.data_vencimento)}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <StatusBadge tone={imp.status === "CONFIRMED" ? "ok" : "warn"}>
                    {IMPORT_STATUS_LABELS[imp.status]}
                  </StatusBadge>
                  <Link
                    to="/cartoes/$cardId"
                    params={{ cardId: cartao.id }}
                    className="text-xs font-semibold text-primary hover:underline"
                  >
                    Ver faturas
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        </Card>
      )}




      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <Metric label="Total das faturas abertas" value={formatCurrency(totalFaturasAbertas)} big />
        <Metric label="Saldo disponível em contas" value={formatCurrency(saldoContas)} big />
        <Metric
          label="Capacidade de pagamento"
          value={formatCurrency(capacidade)}
          tone={capacidade < 0 ? "danger" : "ok"}
          big
        />
        <Metric label="Limite total ativo" value={formatCurrency(totalLimite)} big />
      </div>

      <Card className="mt-4">
        <Badge tone={statusTone}>{statusPagamento.toUpperCase()}</Badge>
        <p className="mt-2 text-sm text-muted-foreground">{statusTexto}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          Limite utilizado somado: {formatCurrency(totalUtilizado)}
        </p>
      </Card>

      <Card className="mt-4">
        <div className="mb-3">
          <SearchInput
            value={busca}
            onChange={setBusca}
            label="Buscar cartão"
            placeholder="Cartão, banco ou titular"
          />
        </div>
        <div className="grid gap-4 sm:grid-cols-3">
          {view.isAdmin ? (
            <MemberFilter familyId={family.id} value={filtroMembro} onChange={setFiltroMembro} />
          ) : (
            <div className="flex items-end">
              <ViewModeSwitch mode={view.mode} onChange={view.setMode} canSwitch={false} />
            </div>
          )}
          <Field label="Banco">
            <select
              className={inputClass}
              value={filtroBanco}
              onChange={(e) => setFiltroBanco(e.target.value)}
              aria-label="Banco"
            >
              <option value="">Todos</option>
              {bancos.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Período (vencimento)">
            <input
              type="month"
              className={inputClass}
              value={mes}
              onChange={(e) => setMes(e.target.value)}
            />
          </Field>
        </div>
      </Card>

      <div className="mt-4 grid gap-4">
        {dados.isLoading ? (
          <Card>
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </Card>
        ) : visiveis.length ? (
          visiveis.map((c) => {
            const info = dados.info(c.id);
            const limite = Number(c.limite) || 0;
            const utilizado = dados.utilizadoDe(c.id);
            const disponivel = limite - utilizado;
            const uso = limite > 0 ? Math.min(100, (utilizado / limite) * 100) : 0;
            const fatura = info?.faturaAtual ?? null;

            return (
              <Link
                key={c.id}
                to="/cartoes/$cardId"
                params={{ cardId: c.id }}
                className="block rounded-3xl border border-border bg-card p-6 shadow-card transition-colors hover:bg-muted/40"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h2 className="text-base font-bold">
                      {c.banco} · {c.nome_cartao}
                      {c.ativo ? "" : " · inativo"}
                    </h2>
                    <p className="text-xs text-muted-foreground">
                      Titular: {memberName(c.member_id)} ·{" "}
                      {fatura
                        ? `fatura ${fatura.status.toLowerCase()}`
                        : "sem fatura aberta no momento"}
                    </p>
                  </div>
                  <span className="text-xs font-semibold text-primary">Abrir cartão completo</span>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric label="Limite" value={formatCurrency(limite)} />
                  <Metric label="Utilizado" value={formatCurrency(utilizado)} />
                  <Metric
                    label="Disponível"
                    value={formatCurrency(disponivel)}
                    tone={disponivel < 0 ? "danger" : "ok"}
                  />
                  {(() => {
                    const ciclo = dados.faturaDe(c.id, fatura);
                    return <Metric label={ciclo.label} value={formatCurrency(ciclo.valor)} />;
                  })()}

                  <Metric
                    label="Vence"
                    value={
                      info?.proximoVencimento
                        ? formatDate(info.proximoVencimento)
                        : `dia ${c.dia_vencimento}`
                    }
                  />
                </div>

                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${TONE_DOTS[usageTone(uso)]}`}
                    style={{ width: `${uso}%` }}
                  />
                </div>
              </Link>
            );
          })
        ) : (
          <Card>
            <EmptyState
              icon={<CreditCard className="size-5" />}
              title={temFiltro ? "Nenhum cartão com esses filtros" : "Nenhum cartão cadastrado"}
              description={
                temFiltro
                  ? "Ajuste a busca, o banco ou o período de vencimento."
                  : "Os cartões são cadastrados no perfil de cada pessoa, na aba “Cartões”."
              }
              action={
                temFiltro ? (
                  <button
                    type="button"
                    onClick={() => {
                      setBusca("");
                      setFiltroBanco("");
                      setMes("");
                    }}
                    className="min-h-11 rounded-full border border-border px-5 py-2.5 text-sm font-semibold text-muted-foreground transition-colors hover:bg-muted"
                  >
                    Limpar filtros
                  </button>
                ) : (
                  <Link
                    to="/configuracoes"
                    className="inline-flex min-h-11 items-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground"
                  >
                    Ir para Família e Finanças
                  </Link>
                )
              }
            />
          </Card>
        )}
      </div>
    </div>
  );
}
