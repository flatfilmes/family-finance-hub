import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, PageHeader, inputClass } from "@/components/page-header";
import { useFamily } from "@/hooks/useFamilyData";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useCardOverview } from "@/hooks/useCardInvoices";
import { useMemberName } from "@/components/member-select";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { formatDate } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";
import { NoFamily } from "./receitas";

export const Route = createFileRoute("/_authenticated/cartoes")({
  head: () => ({
    meta: [
      { title: "Cartões da Família — Família Finance AI" },
      {
        name: "description",
        content: "Controle das faturas, limites e vencimentos dos cartões de cada pessoa da família.",
      },
      { property: "og:title", content: "Cartões da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Faturas, limites e vencimentos dos cartões da família.",
      },
    ],
  }),
  component: CartoesPage,
});

function CartoesPage() {
  const { data: family } = useFamily();
  const { data: cards, isLoading } = useCreditCards(family?.id);
  const overview = useCardOverview(family?.id, cards ?? []);
  const memberName = useMemberName(family?.id);

  const [filtroMembro, setFiltroMembro] = useState("");
  const view = useViewMode();
  const [filtroBanco, setFiltroBanco] = useState("");
  const [mes, setMes] = useState("");

  if (!family) return <NoFamily />;

  const bancos = Array.from(new Set((cards ?? []).map((c) => c.banco))).sort();

  const lista = filterByMember(cards ?? [], view.scoped(filtroMembro)).filter((c) =>
    filtroBanco ? c.banco === filtroBanco : true,
  );

  const info = (id: string) => overview.porCartao.find((o) => o.card.id === id);
  const visiveis = lista.filter((c) => {
    if (!mes) return true;
    const venc = info(c.id)?.proximoVencimento;
    return !!venc && venc.startsWith(mes);
  });

  const totalLimite = visiveis
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const totalFatura = visiveis.reduce((acc, c) => acc + (info(c.id)?.valorFaturaAtual ?? 0), 0);

  return (
    <div>
      <PageHeader
        title="Cartões da família"
        subtitle="Acompanhe fatura, limite e vencimento de cada cartão. O cadastro acontece no perfil da pessoa."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <Card>
          <p className="text-xs font-semibold text-muted-foreground">Fatura atual somada</p>
          <p className="mt-1 text-2xl font-extrabold">{formatCurrency(totalFatura)}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-muted-foreground">Limite total ativo</p>
          <p className="mt-1 text-2xl font-extrabold">{formatCurrency(totalLimite)}</p>
        </Card>
      </div>

      <Card className="mt-4">
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

      <Card className="mt-4">
        <h2 className="text-base font-bold">Cartões</h2>
        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : visiveis.length ? (
          <ul className="mt-2 divide-y divide-border">
            {visiveis.map((c) => {
              const dados = info(c.id);
              return (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-3 py-4">
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-semibold">
                      {memberName(c.member_id)} · {c.banco} · {c.nome_cartao}
                      {c.ativo ? "" : " · inativo"}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                      <span>
                        Fatura atual:{" "}
                        <span className="font-semibold text-foreground">
                          {formatCurrency(dados?.valorFaturaAtual ?? 0)}
                        </span>
                      </span>
                      <span>
                        Limite:{" "}
                        <span className="font-semibold text-foreground">
                          {formatCurrency(Number(c.limite))}
                        </span>
                      </span>
                      <span>
                        Vencimento:{" "}
                        <span className="font-semibold text-foreground">
                          {dados?.proximoVencimento
                            ? formatDate(dados.proximoVencimento)
                            : `dia ${c.dia_vencimento}`}
                        </span>
                      </span>
                      <span>
                        Parcelas futuras:{" "}
                        <span className="font-semibold text-foreground">
                          {formatCurrency(dados?.parcelasFuturas ?? 0)}
                        </span>
                      </span>
                    </div>
                  </div>
                  {c.member_id && (
                    <Link
                      to="/membro/$memberId"
                      params={{ memberId: c.member_id }}
                      className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                    >
                      Ver perfil
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhum cartão encontrado. Abra o perfil de uma pessoa em Minha Família e cadastre o
            cartão na aba “Cartões”.
          </p>
        )}
      </Card>
    </div>
  );
}
