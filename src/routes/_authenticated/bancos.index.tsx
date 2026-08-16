import { useState } from "react";
import { ArrowLeftRight, Landmark } from "lucide-react";
import { SearchInput, matchesSearch } from "@/components/search-input";
import { EmptyState } from "@/components/empty-state";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, PageHeader, inputClass } from "@/components/page-header";
import { Metric } from "@/components/detail-page";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { useStickyState } from "@/hooks/useStickyState";
import { formatCurrency } from "@/lib/finance";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/bank-accounts";
import { currentMonth, monthLabel } from "@/lib/expenses";
import type { Transaction } from "@/lib/transactions";
import { NoFamily } from "@/components/no-family";
import { TransferDialog } from "@/components/transfer-dialog";

export const Route = createFileRoute("/_authenticated/bancos/")({
  head: () => ({
    meta: [
      { title: "Bancos da Família — Família Finance AI" },
      {
        name: "description",
        content:
          "Visão consolidada das contas bancárias: saldos, entradas, saídas e pagamentos de cartão por pessoa.",
      },
      { property: "og:title", content: "Bancos da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Saldo total, movimentações e histórico de cada conta bancária da família.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BancosPage,
});

function BancosPage() {
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: accounts, isLoading } = useBankAccounts(family?.id);
  const { data: movimentos } = useTransactions(family?.id);
  const view = useViewMode();

  const [filtroMembro, setFiltroMembro] = useStickyState("bancos:membro", "");
  const [filtroBanco, setFiltroBanco] = useStickyState("bancos:banco", "");
  const [periodo, setPeriodo] = useStickyState("bancos:periodo", currentMonth());
  const [busca, setBusca] = useStickyState("bancos:busca", "");
  const [transferOpen, setTransferOpen] = useState(false);

  if (!family) return <NoFamily />;

  const bancos = Array.from(new Set((accounts ?? []).map((a) => a.banco))).sort();

  const lista = filterByMember(accounts ?? [], view.scoped(filtroMembro)).filter(
    (a) =>
      (filtroBanco ? a.banco === filtroBanco : true) &&
      matchesSearch(busca, a.banco, a.nome_conta),
  );
  const temFiltro = Boolean(busca || filtroBanco || filtroMembro);

  const idsVisiveis = new Set(lista.map((a) => a.id));
  const movimentosVisiveis = (movimentos ?? []).filter(
    (t) =>
      t.bank_account_id &&
      idsVisiveis.has(t.bank_account_id) &&
      t.status !== "CANCELADA" &&
      (!periodo || t.data_movimento.startsWith(periodo)),
  );

  const soma = (tipo: Transaction["tipo"]) =>
    movimentosVisiveis
      .filter((t) => t.tipo === tipo)
      .reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  const saldoTotal = lista
    .filter((a) => a.ativo)
    .reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const entradas = soma("ENTRADA");
  const saidas = soma("SAIDA");
  const pagamentos = soma("PAGAMENTO_CARTAO");
  const liquido = entradas - saidas - pagamentos;

  const grupos = (members ?? [])
    .map((m) => ({ membro: m, contas: lista.filter((a) => a.member_id === m.id) }))
    .filter((g) => g.contas.length > 0);
  const semTitular = lista.filter((a) => !a.member_id);

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-4">
        <PageHeader
          title="Bancos da família"
          subtitle="Visão geral das contas. Clique em uma conta para abrir a página completa com extrato e filtros."
        />
        <div className="flex flex-wrap items-center gap-2">
          <Link
            to="/bancos/diagnostico-importacao"
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
          >
            Diagnóstico de importação
          </Link>
          <button
            type="button"
            onClick={() => setTransferOpen(true)}
            disabled={(accounts ?? []).filter((a) => a.ativo).length < 2}
            className="inline-flex min-h-11 items-center gap-2 rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-muted disabled:opacity-50"
          >
            <ArrowLeftRight className="size-4" />
            Transferir entre contas
          </button>
        </div>
      </div>


      <TransferDialog
        open={transferOpen}
        onOpenChange={setTransferOpen}
        familyId={family.id}
        accounts={(accounts ?? []).filter((a) => a.ativo)}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Saldo total em contas" value={formatCurrency(saldoTotal)} big />
        <Metric label="Entradas do período" value={formatCurrency(entradas)} />
        <Metric label="Saídas do período" value={formatCurrency(saidas)} />
        <Metric label="Pagamentos de cartão" value={formatCurrency(pagamentos)} />
        <Metric
          label="Saldo líquido do período"
          value={formatCurrency(liquido)}
          tone={liquido < 0 ? "danger" : "ok"}
        />
      </div>

      <Card className="mt-4">
        <div className="mb-3">
          <SearchInput
            value={busca}
            onChange={setBusca}
            label="Buscar conta"
            placeholder="Banco ou nome da conta"
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
          <Field label="Período">
            <input
              type="month"
              className={inputClass}
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Movimentações de {periodo ? monthLabel(periodo) : "todo o histórico"}. Os valores vêm das
          movimentações confirmadas — cada compra entra uma única vez.
        </p>
      </Card>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
      ) : lista.length === 0 ? (
        <Card className="mt-4">
          <EmptyState
            icon={<Landmark className="size-5" />}
            title={temFiltro ? "Nenhuma conta com esses filtros" : "Nenhuma conta bancária ainda"}
            description={
              temFiltro
                ? "Ajuste a busca ou o filtro de banco para ver as contas da família."
                : "As contas são cadastradas no perfil de cada pessoa, na aba “Contas bancárias”."
            }
            action={
              temFiltro ? (
                <button
                  type="button"
                  onClick={() => {
                    setBusca("");
                    setFiltroBanco("");
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
      ) : (
        <div className="mt-4 grid gap-4">
          {grupos.map(({ membro, contas }) => (
            <Card key={membro.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold">{membro.nome}</h2>
                <Link
                  to="/membro/$memberId"
                  params={{ memberId: membro.id }}
                  className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                >
                  Ver perfil financeiro
                </Link>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {contas.map((a) => (
                  <ContaCard
                    key={a.id}
                    id={a.id}
                    banco={a.banco}
                    nome={a.nome_conta}
                    tipo={BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]}
                    ativo={a.ativo}
                    saldo={Number(a.saldo_atual) || 0}
                  />
                ))}
              </div>
            </Card>
          ))}

          {semTitular.length > 0 && (
            <Card>
              <h2 className="text-base font-bold">Contas da família (sem titular)</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {semTitular.map((a) => (
                  <ContaCard
                    key={a.id}
                    id={a.id}
                    banco={a.banco}
                    nome={a.nome_conta}
                    tipo={BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]}
                    ativo={a.ativo}
                    saldo={Number(a.saldo_atual) || 0}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
}

function ContaCard({
  id,
  banco,
  nome,
  tipo,
  ativo,
  saldo,
}: {
  id: string;
  banco: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  saldo: number;
}) {
  return (
    <Link
      to="/bancos/$accountId"
      params={{ accountId: id }}
      className="block rounded-2xl border border-border p-4 transition-colors hover:bg-muted/60"
    >
      <p className="truncate text-sm font-bold">
        {banco} · {nome}
      </p>
      <p className="text-xs text-muted-foreground">
        {tipo}
        {ativo ? "" : " · inativa"}
      </p>
      <p className="mt-2 text-xl font-extrabold">{formatCurrency(saldo)}</p>
      <span className="mt-2 inline-block text-xs font-semibold text-primary">
        Abrir conta completa
      </span>
    </Link>
  );
}
