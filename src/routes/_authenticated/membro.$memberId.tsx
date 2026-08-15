import { useState } from "react";
import { createFileRoute, Link, useParams } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";
import { Card, PageHeader } from "@/components/page-header";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useMemberProfiles } from "@/hooks/useMemberProfiles";
import { useIncomes, useCreditCards, useFixedExpenses } from "@/hooks/useFinanceData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { usePurchases } from "@/hooks/usePurchases";
import { useExpenses, useExpenseCategories } from "@/hooks/useExpenses";
import { currentMonth, formatDate, monthLabel } from "@/lib/expenses";
import { formatCurrency, monthlyIncomeValue, monthlyExpenseValue } from "@/lib/finance";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/bank-accounts";
import { MEMBER_PROFILE_DESCRIPTIONS, MEMBER_PROFILE_LABELS } from "@/lib/member-profiles";
import { NoFamily } from "./receitas";

export const Route = createFileRoute("/_authenticated/membro/$memberId")({
  head: () => ({
    meta: [
      { title: "Perfil Financeiro do Membro — Família Finance AI" },
      {
        name: "description",
        content:
          "Receitas, contas bancárias, cartões, compras e despesas de cada membro da família.",
      },
      { property: "og:title", content: "Perfil Financeiro do Membro — Família Finance AI" },
      {
        property: "og:description",
        content: "Vida financeira individual dentro da sua família.",
      },
    ],
  }),
  component: MembroPage,
});

const TABS = ["Resumo", "Receitas", "Contas bancárias", "Cartões", "Compras", "Despesas"] as const;
type Tab = (typeof TABS)[number];

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="mt-4 text-sm text-muted-foreground">{children}</p>;
}

function Row({
  title,
  subtitle,
  value,
}: {
  title: string;
  subtitle: string;
  value: string;
}) {
  return (
    <li className="flex items-center justify-between gap-4 py-3">
      <div className="min-w-0">
        <p className="truncate text-sm font-semibold">{title}</p>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </div>
      <span className="shrink-0 text-sm font-semibold">{value}</span>
    </li>
  );
}

function MembroPage() {
  const { memberId } = useParams({ from: "/_authenticated/membro/$memberId" });
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: profiles } = useMemberProfiles(family?.id);
  const month = currentMonth();

  const { data: incomes } = useIncomes(family?.id);
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: cards } = useCreditCards(family?.id);
  const { data: fixed } = useFixedExpenses(family?.id);
  const { data: purchases } = usePurchases(family?.id);
  const { data: expenses } = useExpenses(family?.id, { month });
  const { data: categories } = useExpenseCategories();

  const [tab, setTab] = useState<Tab>("Resumo");

  if (!family) return <NoFamily />;

  const member = members?.find((m) => m.id === memberId);
  if (!member) {
    return (
      <div>
        <PageHeader title="Membro não encontrado" subtitle="Volte para a lista da família." />
        <Link to="/minha-familia" className="text-sm font-semibold text-primary">
          Voltar para Minha Família
        </Link>
      </div>
    );
  }

  const perfil = profiles?.find((p) => p.family_member_id === member.id)?.tipo_perfil ?? "MEMBRO";
  const mine = <T extends { member_id: string | null }>(rows?: T[]) =>
    (rows ?? []).filter((r) => r.member_id === member.id);

  const myIncomes = mine(incomes);
  const myAccounts = mine(accounts);
  const myCards = mine(cards);
  const myFixed = mine(fixed);
  const myPurchases = mine(purchases);
  const myExpenses = mine(expenses);

  const totalReceitas = myIncomes
    .filter((i) => i.ativo)
    .reduce((acc, i) => acc + monthlyIncomeValue(i), 0);
  const totalContasFixas = myFixed
    .filter((f) => f.ativo)
    .reduce((acc, f) => acc + monthlyExpenseValue(f), 0);
  const totalGastos = myExpenses.reduce((acc, e) => acc + (Number(e.valor) || 0), 0);
  const totalSaldoContas = myAccounts
    .filter((a) => a.ativo)
    .reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const limiteCartoes = myCards
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const categoriaNome = (id: string | null) =>
    categories?.find((c) => c.id === id)?.nome ?? "Sem categoria";

  const stats = [
    { label: "Receita mensal", value: formatCurrency(totalReceitas) },
    { label: "Contas fixas", value: formatCurrency(totalContasFixas) },
    { label: `Gastos · ${monthLabel(month)}`, value: formatCurrency(totalGastos) },
    { label: "Saldo em contas", value: formatCurrency(totalSaldoContas) },
    { label: "Limite em cartões", value: formatCurrency(limiteCartoes) },
    { label: "Sobra estimada", value: formatCurrency(totalReceitas - totalContasFixas - totalGastos) },
  ];

  return (
    <div>
      <Link
        to="/minha-familia"
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="size-4" />
        Minha Família
      </Link>

      <PageHeader
        title={member.nome}
        subtitle={`${MEMBER_PROFILE_LABELS[perfil]} · ${MEMBER_PROFILE_DESCRIPTIONS[perfil]}`}
      />

      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map((t) => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={
              t === tab
                ? "rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
                : "rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            }
          >
            {t}
          </button>
        ))}
      </div>

      {tab === "Resumo" && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {stats.map((s) => (
            <Card key={s.label}>
              <p className="text-xs font-semibold text-muted-foreground">{s.label}</p>
              <p className="mt-2 text-2xl font-extrabold">{s.value}</p>
            </Card>
          ))}
        </div>
      )}

      {tab === "Receitas" && (
        <Card>
          <h2 className="text-base font-bold">Receitas de {member.nome}</h2>
          {myIncomes.length ? (
            <ul className="mt-2 divide-y divide-border">
              {myIncomes.map((i) => (
                <Row
                  key={i.id}
                  title={i.descricao}
                  subtitle={`${i.tipo === "FIXA" ? "Fixa" : "Variável"} · ${i.frequencia.toLowerCase()}${i.ativo ? "" : " · inativa"}`}
                  value={formatCurrency(Number(i.valor))}
                />
              ))}
            </ul>
          ) : (
            <Empty>
              Nenhuma receita vinculada. Cadastre em Receitas escolhendo {member.nome} como
              responsável.
            </Empty>
          )}
        </Card>
      )}

      {tab === "Contas bancárias" && (
        <Card>
          <h2 className="text-base font-bold">Contas bancárias</h2>
          {myAccounts.length ? (
            <ul className="mt-2 divide-y divide-border">
              {myAccounts.map((a) => (
                <Row
                  key={a.id}
                  title={`${a.banco} · ${a.nome_conta}`}
                  subtitle={`${BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]}${a.ativo ? "" : " · inativa"}`}
                  value={formatCurrency(Number(a.saldo_atual))}
                />
              ))}
            </ul>
          ) : (
            <Empty>
              Nenhuma conta bancária cadastrada para {member.nome}. Adicione em Contas Bancárias.
            </Empty>
          )}
        </Card>
      )}

      {tab === "Cartões" && (
        <Card>
          <h2 className="text-base font-bold">Cartões</h2>
          {myCards.length ? (
            <ul className="mt-2 divide-y divide-border">
              {myCards.map((c) => (
                <Row
                  key={c.id}
                  title={`${c.banco} · ${c.nome_cartao}`}
                  subtitle={`Fecha dia ${c.dia_fechamento} · vence dia ${c.dia_vencimento}${c.ativo ? "" : " · inativo"}`}
                  value={formatCurrency(Number(c.limite))}
                />
              ))}
            </ul>
          ) : (
            <Empty>Nenhum cartão vinculado a {member.nome}. Cadastre na página Cartões.</Empty>
          )}
        </Card>
      )}

      {tab === "Compras" && (
        <Card>
          <h2 className="text-base font-bold">Compras</h2>
          {myPurchases.length ? (
            <ul className="mt-2 divide-y divide-border">
              {myPurchases.map((p) => (
                <Row
                  key={p.id}
                  title={p.estabelecimento}
                  subtitle={formatDate(p.data_compra)}
                  value={formatCurrency(Number(p.valor_total))}
                />
              ))}
            </ul>
          ) : (
            <Empty>Nenhuma compra registrada com {member.nome} como responsável.</Empty>
          )}
        </Card>
      )}

      {tab === "Despesas" && (
        <Card>
          <h2 className="text-base font-bold">Despesas · {monthLabel(month)}</h2>
          {myExpenses.length ? (
            <ul className="mt-2 divide-y divide-border">
              {myExpenses.map((e) => (
                <Row
                  key={e.id}
                  title={e.descricao}
                  subtitle={`${categoriaNome(e.categoria_id)} · ${formatDate(e.data_compra)}`}
                  value={formatCurrency(Number(e.valor))}
                />
              ))}
            </ul>
          ) : (
            <Empty>Nenhuma despesa deste mês com {member.nome} como responsável.</Empty>
          )}
        </Card>
      )}
    </div>
  );
}
