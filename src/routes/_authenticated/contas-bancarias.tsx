import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, PageHeader } from "@/components/page-header";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { formatCurrency } from "@/lib/finance";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/bank-accounts";
import { useTransactions } from "@/hooks/useTransactions";
import { formatDate } from "@/lib/expenses";
import {
  TRANSACTION_STATUS_CLASSES,
  TRANSACTION_STATUS_LABELS,
  TRANSACTION_TYPE_LABELS,
  type Transaction,
} from "@/lib/transactions";
import { NoFamily } from "./receitas";

export const Route = createFileRoute("/_authenticated/contas-bancarias")({
  head: () => ({
    meta: [
      { title: "Contas Bancárias da Família — Família Finance AI" },
      {
        name: "description",
        content: "Visão consolidada das contas bancárias da família, agrupadas por titular.",
      },
      { property: "og:title", content: "Contas Bancárias da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Banco, titular e saldo de cada conta da família.",
      },
    ],
  }),
  component: ContasBancariasPage,
});

function ContasBancariasPage() {
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: accounts, isLoading } = useBankAccounts(family?.id);
  const [filtroMembro, setFiltroMembro] = useState("");
  const { data: movimentos } = useTransactions(family?.id);
  const view = useViewMode();

  if (!family) return <NoFamily />;

  const lista = filterByMember(accounts ?? [], view.scoped(filtroMembro));
  const saldoTotal = lista
    .filter((a) => a.ativo)
    .reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);

  const grupos = (members ?? [])
    .map((m) => ({ membro: m, contas: lista.filter((a) => a.member_id === m.id) }))
    .filter((g) => g.contas.length > 0);
  const semTitular = lista.filter((a) => !a.member_id);

  return (
    <div>
      <PageHeader
        title="Contas bancárias da família"
        subtitle="Cada conta pertence a uma pessoa. O cadastro acontece no perfil individual."
      />

      <Card>
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold text-muted-foreground">Saldo somado (contas ativas)</p>
            <p className="mt-1 text-2xl font-extrabold">{formatCurrency(saldoTotal)}</p>
          </div>
          {view.isAdmin ? (
            <div className="w-48">
              <MemberFilter familyId={family.id} value={filtroMembro} onChange={setFiltroMembro} />
            </div>
          ) : (
            <ViewModeSwitch mode={view.mode} onChange={view.setMode} canSwitch={false} />
          )}
        </div>
      </Card>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
      ) : grupos.length === 0 && semTitular.length === 0 ? (
        <Card className="mt-4">
          <p className="text-sm text-muted-foreground">
            Nenhuma conta bancária cadastrada. Abra o perfil de uma pessoa em Minha Família e
            adicione a conta na aba “Contas bancárias”.
          </p>
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
              <ul className="mt-2 divide-y divide-border">
                {contas.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {a.banco} · {a.nome_conta}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]} · titular {membro.nome}
                        {a.ativo ? "" : " · inativa"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold">
                      {formatCurrency(Number(a.saldo_atual))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ))}

          {semTitular.length > 0 && (
            <Card>
              <h2 className="text-base font-bold">Contas da família (sem titular)</h2>
              <ul className="mt-2 divide-y divide-border">
                {semTitular.map((a) => (
                  <li key={a.id} className="flex items-center justify-between gap-4 py-3">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">
                        {a.banco} · {a.nome_conta}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]}
                        {a.ativo ? "" : " · inativa"}
                      </p>
                    </div>
                    <span className="shrink-0 text-sm font-bold">
                      {formatCurrency(Number(a.saldo_atual))}
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      )}

      {lista.length > 0 && (
        <Card className="mt-4">
          <h2 className="text-base font-bold">Movimentação das contas</h2>
          <p className="text-xs text-muted-foreground">
            Entradas, saídas e pagamentos de cartão que passaram por cada conta.
          </p>
          <div className="mt-4 grid gap-4">
            {lista.map((a) => (
              <Movimentacao
                key={a.id}
                titulo={`${a.banco} · ${a.nome_conta}`}
                saldo={Number(a.saldo_atual) || 0}
                movimentos={(movimentos ?? []).filter((t) => t.bank_account_id === a.id)}
              />
            ))}
          </div>
        </Card>
      )}
    </div>
  );
}

function Movimentacao({
  titulo,
  saldo,
  movimentos,
}: {
  titulo: string;
  saldo: number;
  movimentos: Transaction[];
}) {
  const validas = movimentos.filter((t) => t.status !== "CANCELADA");
  const soma = (tipo: Transaction["tipo"]) =>
    validas.filter((t) => t.tipo === tipo).reduce((acc, t) => acc + (Number(t.valor) || 0), 0);
  const entradas = soma("ENTRADA");
  const saidas = soma("SAIDA");
  const pagamentos = soma("PAGAMENTO_CARTAO");

  return (
    <div className="rounded-2xl border border-border p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold">{titulo}</p>
        <p className="text-sm font-bold">{formatCurrency(saldo)}</p>
      </div>
      <div className="mt-3 grid gap-3 sm:grid-cols-3">
        <Resumo label="Entradas" value={formatCurrency(entradas)} />
        <Resumo label="Saídas" value={formatCurrency(saidas)} />
        <Resumo label="Pagamentos de cartão" value={formatCurrency(pagamentos)} />
      </div>
      {validas.length === 0 ? (
        <p className="mt-3 text-xs text-muted-foreground">Nenhuma movimentação nesta conta.</p>
      ) : (
        <ul className="mt-3 divide-y divide-border">
          {movimentos.slice(0, 8).map((t) => (
            <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{t.descricao}</p>
                <p className="text-xs text-muted-foreground">
                  {formatDate(t.data_movimento)} · {TRANSACTION_TYPE_LABELS[t.tipo]}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TRANSACTION_STATUS_CLASSES[t.status]}`}
                >
                  {TRANSACTION_STATUS_LABELS[t.status]}
                </span>
                <span className="text-sm font-bold">
                  {t.tipo === "ENTRADA" ? "+" : "-"}
                  {formatCurrency(Number(t.valor) || 0)}
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function Resumo({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold">{value}</p>
    </div>
  );
}
