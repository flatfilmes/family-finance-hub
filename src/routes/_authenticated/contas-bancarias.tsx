import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, PageHeader } from "@/components/page-header";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { formatCurrency } from "@/lib/finance";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/bank-accounts";
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

  if (!family) return <NoFamily />;

  const lista = filterByMember(accounts ?? [], filtroMembro);
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
          <div className="w-48">
            <MemberFilter familyId={family.id} value={filtroMembro} onChange={setFiltroMembro} />
          </div>
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
    </div>
  );
}
