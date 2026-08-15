import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, PageHeader, inputClass } from "@/components/page-header";
import { useFamily } from "@/hooks/useFamilyData";
import { useCreditCards } from "@/hooks/useFinanceData";
import { useCardOverview } from "@/hooks/useCardInvoices";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { usePurchases } from "@/hooks/usePurchases";
import { usePayCardInvoice } from "@/hooks/useTransactions";
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
        content:
          "Controle das faturas, limites, uso e vencimentos dos cartões de cada pessoa da família.",
      },
      { property: "og:title", content: "Cartões da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Faturas, limite utilizado e pagamento das faturas dos cartões da família.",
      },
    ],
  }),
  component: CartoesPage,
});

/** Agrupa as compras do cartão por natureza (normal, parcelada, recorrente). */
function kindOf(tipo: string) {
  if (tipo === "COMPRA_PARCELADA" || tipo === "PARCELADO") return "parceladas" as const;
  if (tipo === "COMPRA_RECORRENTE" || tipo === "CONTA_RECORRENTE") return "recorrentes" as const;
  return "normais" as const;
}

function CartoesPage() {
  const { data: family } = useFamily();
  const { data: cards, isLoading } = useCreditCards(family?.id);
  const overview = useCardOverview(family?.id, cards ?? []);
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: purchases } = usePurchases(family?.id);
  const memberName = useMemberName(family?.id);
  const pagar = usePayCardInvoice(family?.id);

  const [filtroMembro, setFiltroMembro] = useState("");
  const view = useViewMode();
  const [filtroBanco, setFiltroBanco] = useState("");
  const [mes, setMes] = useState("");
  const [pagando, setPagando] = useState<string>("");
  const [contaPagamento, setContaPagamento] = useState("");
  const [erro, setErro] = useState("");

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

  const comprasDoCartao = (cardId: string) =>
    (purchases ?? []).filter((p) => p.credit_card_id === cardId);

  const resumoCompras = (cardId: string) => {
    const base = { normais: 0, parceladas: 0, recorrentes: 0 };
    for (const p of comprasDoCartao(cardId)) {
      base[kindOf(p.tipo_compra as string)] += Number(p.valor_total) || 0;
    }
    return base;
  };

  const utilizadoDe = (cardId: string) => {
    const dados = info(cardId);
    const compras = comprasDoCartao(cardId)
      .filter((p) => p.status_pagamento === "COMPROMETIDO")
      .reduce((acc, p) => acc + (Number(p.valor_total) || 0), 0);
    return (dados?.valorFaturaAtual ?? 0) + (dados?.parcelasFuturas ?? 0) + compras;
  };

  const contasAtivas = filterByMember(accounts ?? [], view.scoped(filtroMembro)).filter(
    (a) => a.ativo,
  );

  const totalLimite = visiveis
    .filter((c) => c.ativo)
    .reduce((acc, c) => acc + (Number(c.limite) || 0), 0);
  const totalFatura = visiveis.reduce((acc, c) => acc + (info(c.id)?.valorFaturaAtual ?? 0), 0);
  const totalUtilizado = visiveis.reduce((acc, c) => acc + utilizadoDe(c.id), 0);

  async function confirmarPagamento(invoiceId: string) {
    setErro("");
    if (!contaPagamento) {
      setErro("Escolha a conta bancária de origem.");
      return;
    }
    try {
      await pagar.mutateAsync({ invoiceId, bankAccountId: contaPagamento });
      setPagando("");
      setContaPagamento("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível pagar a fatura.");
    }
  }

  return (
    <div>
      <PageHeader
        title="Cartões da família"
        subtitle="Fatura, limite utilizado, vencimento e pagamento de cada cartão. O cadastro acontece no perfil da pessoa."
      />

      <div className="grid gap-4 sm:grid-cols-3">
        <Card>
          <p className="text-xs font-semibold text-muted-foreground">Fatura atual somada</p>
          <p className="mt-1 text-2xl font-extrabold">{formatCurrency(totalFatura)}</p>
        </Card>
        <Card>
          <p className="text-xs font-semibold text-muted-foreground">Limite utilizado</p>
          <p className="mt-1 text-2xl font-extrabold">{formatCurrency(totalUtilizado)}</p>
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

      <div className="mt-4 grid gap-4">
        {isLoading ? (
          <Card>
            <p className="text-sm text-muted-foreground">Carregando...</p>
          </Card>
        ) : visiveis.length ? (
          visiveis.map((c) => {
            const dados = info(c.id);
            const limite = Number(c.limite) || 0;
            const utilizado = utilizadoDe(c.id);
            const disponivel = limite - utilizado;
            const uso = limite > 0 ? Math.min(100, (utilizado / limite) * 100) : 0;
            const grupos = resumoCompras(c.id);
            const fatura = dados?.faturaAtual ?? null;
            const podePagar =
              !view.isViewer && !!fatura && fatura.status !== "PAGA" && Number(fatura.valor_total) > 0;

            return (
              <Card key={c.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="text-base font-bold">
                      {c.banco} · {c.nome_cartao}
                      {c.ativo ? "" : " · inativo"}
                    </h3>
                    <p className="text-xs text-muted-foreground">
                      Titular: {memberName(c.member_id)}
                    </p>
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
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
                  <Metric label="Limite" value={formatCurrency(limite)} />
                  <Metric label="Utilizado" value={formatCurrency(utilizado)} />
                  <Metric
                    label="Disponível"
                    value={formatCurrency(disponivel)}
                    tone={disponivel < 0 ? "danger" : "ok"}
                  />
                  <Metric label="Fatura atual" value={formatCurrency(dados?.valorFaturaAtual ?? 0)} />
                  <Metric
                    label="Próximo vencimento"
                    value={
                      dados?.proximoVencimento
                        ? formatDate(dados.proximoVencimento)
                        : `dia ${c.dia_vencimento}`
                    }
                  />
                </div>

                <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
                  <div
                    className={`h-full rounded-full ${uso >= 100 ? "bg-red-500" : uso >= 80 ? "bg-amber-500" : "bg-primary"}`}
                    style={{ width: `${uso}%` }}
                  />
                </div>

                <div className="mt-4 grid gap-2 sm:grid-cols-3">
                  <Group label="Compras normais" value={grupos.normais} />
                  <Group label="Compras parceladas" value={grupos.parceladas} />
                  <Group label="Compras recorrentes" value={grupos.recorrentes} />
                </div>

                {fatura && (
                  <div className="mt-4 rounded-2xl bg-muted/50 p-4">
                    <p className="text-xs text-muted-foreground">
                      Fatura de {formatDate(fatura.data_inicio_ciclo)} a{" "}
                      {formatDate(fatura.data_fechamento)} · vence{" "}
                      {formatDate(fatura.data_vencimento)} ·{" "}
                      <span className="font-semibold text-foreground">
                        {formatCurrency(Number(fatura.valor_total))}
                      </span>
                    </p>

                    {podePagar &&
                      (pagando === fatura.id ? (
                        <div className="mt-3 flex flex-wrap items-end gap-3">
                          <Field label="Conta de origem">
                            <select
                              className={inputClass}
                              value={contaPagamento}
                              onChange={(e) => setContaPagamento(e.target.value)}
                              aria-label="Conta bancária de origem"
                            >
                              <option value="">Selecione</option>
                              {contasAtivas.map((a) => (
                                <option key={a.id} value={a.id}>
                                  {a.banco} · {a.nome_conta} ({formatCurrency(Number(a.saldo_atual))}
                                  )
                                </option>
                              ))}
                            </select>
                          </Field>
                          <button
                            type="button"
                            onClick={() => void confirmarPagamento(fatura.id)}
                            disabled={pagar.isPending}
                            className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                          >
                            {pagar.isPending ? "Pagando..." : "Confirmar pagamento"}
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setPagando("");
                              setErro("");
                            }}
                            className="rounded-full border border-border px-5 py-2 text-xs font-semibold text-muted-foreground"
                          >
                            Cancelar
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          onClick={() => {
                            setPagando(fatura.id);
                            setContaPagamento("");
                            setErro("");
                          }}
                          className="mt-3 rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground"
                        >
                          Pagar fatura
                        </button>
                      ))}

                    {fatura.status === "PAGA" && (
                      <p className="mt-2 text-xs font-semibold text-emerald-600">Fatura paga</p>
                    )}
                    {pagando === fatura.id && erro && (
                      <p className="mt-2 text-xs font-semibold text-destructive">{erro}</p>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        ) : (
          <Card>
            <p className="text-sm text-muted-foreground">
              Nenhum cartão encontrado. Abra o perfil de uma pessoa em Minha Família e cadastre o
              cartão na aba “Cartões”.
            </p>
          </Card>
        )}
      </div>
    </div>
  );
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger";
}) {
  return (
    <div>
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p
        className={`mt-1 text-lg font-extrabold ${tone === "danger" ? "text-destructive" : ""}`}
      >
        {value}
      </p>
    </div>
  );
}

function Group({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-2xl border border-border px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p className="mt-1 text-sm font-bold">{formatCurrency(value)}</p>
    </div>
  );
}
