import { useEffect, useRef, useState } from "react";
import { ChevronLeft, ChevronRight, FileUp, MoreHorizontal, Receipt } from "lucide-react";

import { StatementImportDialog } from "@/components/statement-import-dialog";
import { CardStatementImports } from "@/components/card-statement-imports";

import { SearchInput, matchesSearch } from "@/components/search-input";
import { EmptyState } from "@/components/empty-state";
import { TONE_DOTS, usageTone } from "@/lib/status";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, inputClass } from "@/components/page-header";
import { Badge, DetailHeader, Metric, SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { useFamily } from "@/hooks/useFamilyData";
import { useCardsData } from "@/hooks/useCardsData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { usePayCardInvoice } from "@/hooks/useTransactions";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { useMemberName } from "@/components/member-select";
import { filterByMember } from "@/components/member-filter";
import { useViewMode } from "@/components/view-mode";
import { monthKeyLabel } from "@/lib/card-invoices";
import { monthlyValue } from "@/lib/recurring-expenses";
import {
  ESTADO_CICLO_LABELS,
  KIND_OFICIAL_LABELS,
  janelaDeCiclos,
  type EstadoCiclo,
  type KindOficial,
  type LinhaOficial,
} from "@/lib/card-details";

import { useStatementItems } from "@/hooks/useCardStatements";
import { formatDate } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";
import { NoFamily } from "@/components/no-family";

export const Route = createFileRoute("/_authenticated/cartoes/$cardId")({
  head: () => ({
    meta: [
      { title: "Detalhes do cartão — Família Finance AI" },
      {
        name: "description",
        content:
          "Navegue pelos ciclos do cartão: fatura fechada, fatura em formação, lançamentos por dia, parcelamentos e recorrências.",
      },
      { property: "og:title", content: "Detalhes do cartão — Família Finance AI" },
      {
        property: "og:description",
        content: "Fatura, limite, lançamentos e pagamento do cartão organizados por ciclo.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CartaoDetalhePage,
});

const toneEstado = (estado: EstadoCiclo) =>
  estado === "PAGA"
    ? ("ok" as const)
    : estado === "VENCIDA"
      ? ("danger" as const)
      : estado === "EM_FORMACAO"
        ? ("muted" as const)
        : ("warn" as const);

function CartaoDetalhePage() {
  const { cardId } = Route.useParams();
  const { data: family } = useFamily();
  const dados = useCardsData(family?.id);
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: categorias } = useExpenseCategories();
  const memberName = useMemberName(family?.id);
  const pagar = usePayCardInvoice(family?.id);
  const view = useViewMode();

  const [cicloId, setCicloId] = useState("");
  const [filtroTipo, setFiltroTipo] = useState("");
  const [filtroCategoria, setFiltroCategoria] = useState("");
  const [busca, setBusca] = useState("");
  const [pagando, setPagando] = useState(false);
  const [conta, setConta] = useState("");
  const [dataPagamento, setDataPagamento] = useState(new Date().toISOString().slice(0, 10));
  const [erro, setErro] = useState("");
  const [importando, setImportando] = useState(false);
  const [verHistorico, setVerHistorico] = useState(false);
  const [mesesFuturos, setMesesFuturos] = useState(9);
  const reguaRef = useRef<HTMLDivElement | null>(null);
  const ancoraRef = useRef<HTMLButtonElement | null>(null);
  const posicionou = useRef(false);

  // Derivação do ciclo antes dos returns: os lançamentos oficiais são lidos por hook.
  const cartaoSelecionado = dados.cards.find((c) => c.id === cardId) ?? null;
  const ciclos = dados.ciclosDe(cardId);
  const cicloFechado = ciclos.atual;
  const cicloProximo = ciclos.emFormacao;
  // Régua rebalanceada: pouco passado, ciclo atual e o futuro já comprometido.
  const janela = janelaDeCiclos(ciclos.todos, {
    passado: 2,
    futuro: mesesFuturos,
    verHistorico,
  });
  const selecionaveis = janela.visiveis;
  const cicloSelecionado =
    ciclos.todos.find((c) => c.invoice.id === cicloId) ?? cicloFechado ?? cicloProximo ?? null;
  const fatura = cicloSelecionado?.invoice ?? null;
  // Fonte de verdade: fatura oficial importada e confirmada do ciclo > cálculo interno.
  const faturaCiclo = dados.faturaDe(cardId, fatura);
  const itensOficiais = useStatementItems(faturaCiclo.importId ?? undefined);

  // Ao abrir, o ciclo âncora fica no primeiro terço: mais futuro visível que passado.
  useEffect(() => {
    const regua = reguaRef.current;
    const alvo = ancoraRef.current;
    if (!regua || !alvo || posicionou.current) return;
    posicionou.current = true;
    regua.scrollLeft = Math.max(0, alvo.offsetLeft - regua.clientWidth / 3);
  }, [selecionaveis.length]);

  const rolar = (dir: -1 | 1) =>
    reguaRef.current?.scrollBy({ left: dir * 480, behavior: "smooth" });

  if (!family) return <NoFamily />;

  const cartao = cartaoSelecionado;
  if (!cartao) {
    return (
      <div>
        <DetailHeader
          backTo="/cartoes"
          backLabel="Voltar para Cartões"
          title="Cartão não encontrado"
        />
        <Card>
          <p className="text-sm text-muted-foreground">
            Este cartão não existe ou não está disponível para o seu perfil.
          </p>
        </Card>
      </div>
    );
  }

  const limite = Number(cartao.limite) || 0;
  const utilizado = dados.utilizadoDe(cartao.id);
  const disponivel = limite - utilizado;
  const uso = limite > 0 ? Math.min(100, (utilizado / limite) * 100) : 0;

  const estadoSelecionado: EstadoCiclo | null = cicloSelecionado?.estado ?? null;

  // Ciclo fechado com importação confirmada: a fatura do cartão é a fonte oficial.
  // Um lançamento nunca some do resumo por não ter purchase materializada no ciclo.
  const itensDoCiclo = itensOficiais.data ?? [];
  // FONTE ÚNICA: a mesma composição alimenta régua, resumo, lançamentos e
  // compromissos futuros. Não existe cálculo paralelo nesta página.
  const composicaoCiclo = dados.composicaoCicloDe(cartao.id, cicloSelecionado, itensDoCiclo);
  const usarOficial = composicaoCiclo.source === "OFFICIAL_STATEMENT";
  const linhas: LinhaOficial[] = composicaoCiclo.linhas;
  const filtradas = linhas.filter(
    (l) =>
      (!filtroTipo || l.kind === filtroTipo) &&
      (!filtroCategoria || l.categoriaId === filtroCategoria) &&
      matchesSearch(busca, l.estabelecimento),
  );
  const soma = (kind: KindOficial) =>
    kind === "normais"
      ? composicaoCiclo.normalPurchases
      : kind === "parceladas"
        ? composicaoCiclo.installments
        : kind === "recorrentes"
          ? composicaoCiclo.recurringOccurrences
          : kind === "taxas"
            ? composicaoCiclo.fees
            : composicaoCiclo.credits;
  const totalCiclo = composicaoCiclo.total;

  const categoriaNome = (id: string | null) =>
    (categorias ?? []).find((c) => c.id === id)?.nome ?? "—";

  // Lançamentos agrupados por dia (leitura natural, sem tabela gigante).
  const porDia = new Map<string, LinhaOficial[]>();
  for (const l of filtradas) {
    const chave = l.data || "sem-data";
    porDia.set(chave, [...(porDia.get(chave) ?? []), l]);
  }
  const dias = [...porDia.entries()].sort((a, b) => (a[0] < b[0] ? 1 : -1));

  const parcelamentos = dados.parcelamentosDe(cartao.id);
  const recorrenciasCartao = dados.recorrenciasDoCartao(cartao.id).filter((r) => r.ativo);
  const recorrenciasAtivas = recorrenciasCartao.length;
  const recorrenciasMensais = recorrenciasCartao.reduce((acc, r) => acc + monthlyValue(r), 0);
  // Restante comprometido = soma das parcelas ainda não quitadas (nunca o total original).
  const restanteParcelas = parcelamentos.reduce((acc, p) => acc + p.restante, 0);

  const composicao = dados.composicaoDe(cartao.id);

  // Capacidade de pagamento: mesma fórmula da visão geral, aplicada às contas do titular.
  const contasAutorizadas = filterByMember(accounts ?? [], cartao.member_id ?? "sem").filter(
    (a) => a.ativo,
  );
  const saldoContas = contasAutorizadas.reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const valorFaturaAberta = fatura && fatura.status !== "PAGA" ? faturaCiclo.valor : 0;
  const capacidade = saldoContas - valorFaturaAberta;
  const statusPagamento =
    capacidade < 0 ? "Crítico" : capacidade < valorFaturaAberta * 0.2 ? "Atenção" : "Seguro";
  const statusTone = capacidade < 0 ? "danger" : statusPagamento === "Atenção" ? "warn" : "ok";

  const contasParaPagar = (accounts ?? []).filter((a) => a.ativo);
  const podePagar = !view.isViewer;
  const projetado = estadoSelecionado === "PROJETADA";
  const emFormacao = estadoSelecionado === "EM_FORMACAO";

  const podePagarEsteCiclo =
    podePagar &&
    !!fatura &&
    fatura.status !== "PAGA" &&
    estadoSelecionado !== "EM_FORMACAO" &&
    !projetado &&
    Number(fatura.valor_total) > 0;

  // Composição de um ciclo projetado: parcelas já conhecidas + recorrências previstas.
  const parcelasDoCiclo = composicaoCiclo.installments;
  const recorrenciasProjetadas = composicaoCiclo.recurringOccurrences;

  async function confirmarPagamento() {
    setErro("");
    if (!fatura) return;
    if (!conta) {
      setErro("Escolha a conta bancária de origem.");
      return;
    }
    try {
      await pagar.mutateAsync({ invoiceId: fatura.id, bankAccountId: conta, data: dataPagamento });
      setPagando(false);
      setConta("");
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível pagar a fatura.");
    }
  }

  return (
    <div>
      <DetailHeader
        backTo="/cartoes"
        backLabel="Voltar para Cartões"
        title={cartao.nome_cartao}
        subtitle={`${memberName(cartao.member_id)} · ${cartao.banco}`}
        badges={
          <>
            <Badge tone={cartao.ativo ? "ok" : "muted"}>{cartao.ativo ? "Ativo" : "Inativo"}</Badge>
            <Badge>Fechamento dia {cartao.dia_fechamento}</Badge>
            <Badge>Vencimento dia {cartao.dia_vencimento}</Badge>
          </>
        }
        actions={
          <>
            <button
              type="button"
              onClick={() => setImportando(true)}
              className="inline-flex items-center gap-2 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
            >
              <FileUp className="size-3.5" /> Importar fatura
            </button>
            <details className="relative">
              <summary className="inline-flex cursor-pointer list-none items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted">
                <MoreHorizontal className="size-3.5" /> Mais
              </summary>
              <div className="absolute right-0 z-20 mt-2 w-60 rounded-2xl border border-border bg-card p-2 shadow-soft">
                <Link
                  to="/cartoes/$cardId/projecao"
                  params={{ cardId: cartao.id }}
                  className="block rounded-xl px-3 py-2 text-xs font-semibold hover:bg-muted"
                >
                  Ver projeção completa
                </Link>
                <Link
                  to="/cartoes/$cardId/projecao"
                  params={{ cardId: cartao.id }}
                  hash="parcelamentos"
                  className="block rounded-xl px-3 py-2 text-xs font-semibold hover:bg-muted"
                >
                  Ver parcelamentos
                </Link>
                <Link
                  to="/cartoes/$cardId/projecao"
                  params={{ cardId: cartao.id }}
                  hash="recorrencias"
                  className="block rounded-xl px-3 py-2 text-xs font-semibold hover:bg-muted"
                >
                  Gerenciar recorrências
                </Link>
                <a
                  href="#importacoes"
                  className="block rounded-xl px-3 py-2 text-xs font-semibold hover:bg-muted"
                >
                  Importações
                </a>
                {cartao.member_id ? (
                  <Link
                    to="/membro/$memberId"
                    params={{ memberId: cartao.member_id }}
                    className="block rounded-xl px-3 py-2 text-xs font-semibold hover:bg-muted"
                  >
                    Ver perfil do titular
                  </Link>
                ) : null}
              </div>
            </details>
          </>
        }
      />

      {importando && (
        <StatementImportDialog
          cards={dados.cards}
          cardIdInicial={cartao.id}
          onClose={() => setImportando(false)}
        />
      )}

      {/* Navegação principal: um ciclo por vez. */}
      {selecionaveis.length === 0 ? (
        <Card>
          <p className="text-sm text-muted-foreground">
            Nenhum ciclo registrado neste cartão ainda. Importe uma fatura ou lance uma compra no
            cartão para começar.
          </p>
        </Card>
      ) : (
        <>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => rolar(-1)}
              aria-label="Ciclos anteriores"
              className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted sm:inline-flex"
            >
              <ChevronLeft className="size-4" />
            </button>
            <div
              ref={reguaRef}
              className="-mx-1 flex flex-1 gap-2 overflow-x-auto px-1 pb-1 [scrollbar-width:thin]"
            >
              {selecionaveis.map((c) => {
                const ativo = c.invoice.id === cicloSelecionado?.invoice.id;
                const ancora = c.invoice.id === janela.ancora?.invoice.id;
                return (
                  <button
                    key={c.invoice.id}
                    type="button"
                    ref={ancora ? ancoraRef : undefined}
                    onClick={() => {
                      setCicloId(c.invoice.id);
                      setPagando(false);
                    }}
                    className={`shrink-0 rounded-2xl border text-left transition ${
                      ativo
                        ? "min-w-[11rem] border-primary bg-accent px-4 py-3 shadow-soft"
                        : "min-w-[9.5rem] border-border px-4 py-3 hover:bg-accent/50"
                    }`}
                  >
                    <span
                      className={`block text-xs font-semibold ${ativo ? "text-foreground" : "text-muted-foreground"}`}
                    >
                      {monthKeyLabel(c.competencia)}
                    </span>
                    <span
                      className={`mt-0.5 block font-extrabold ${ativo ? "text-xl" : "text-base"}`}
                    >
                      {formatCurrency(c.valor)}
                    </span>
                    <span className="mt-1 block">
                      <StatusBadge tone={toneEstado(c.estado)}>
                        {ESTADO_CICLO_LABELS[c.estado]}
                      </StatusBadge>
                    </span>
                  </button>
                );
              })}
            </div>
            <button
              type="button"
              onClick={() => rolar(1)}
              aria-label="Próximos ciclos"
              className="hidden size-9 shrink-0 items-center justify-center rounded-full border border-border text-muted-foreground transition-colors hover:bg-muted sm:inline-flex"
            >
              <ChevronRight className="size-4" />
            </button>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3">
            {janela.ocultosPassado > 0 && (
              <button
                type="button"
                onClick={() => setVerHistorico(true)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Ver histórico ({janela.ocultosPassado} ciclo
                {janela.ocultosPassado > 1 ? "s" : ""} anteriores)
              </button>
            )}
            {verHistorico && (
              <button
                type="button"
                onClick={() => setVerHistorico(false)}
                className="text-xs font-semibold text-muted-foreground hover:underline"
              >
                Ocultar histórico
              </button>
            )}
            {janela.ocultosFuturo > 0 && (
              <button
                type="button"
                onClick={() => setMesesFuturos((m) => m + 6)}
                className="text-xs font-semibold text-primary hover:underline"
              >
                Ver mais meses futuros
              </button>
            )}
            <span className="text-[11px] text-muted-foreground">
              A régua prioriza o futuro comprometido: meses projetados aparecem só quando já existem
              parcelas ou recorrências.
            </span>
          </div>

          {/* Bloco principal: tudo do ciclo selecionado em um único resumo. */}
          <Card className="mt-4">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-sm font-semibold text-muted-foreground">
                  {cicloSelecionado ? monthKeyLabel(cicloSelecionado.competencia) : "Ciclo"}
                </p>
                <p className="mt-1 text-3xl font-black">{formatCurrency(totalCiclo)}</p>
                {fatura && (
                  <p className="mt-2 text-xs text-muted-foreground">
                    Ciclo de {formatDate(fatura.data_inicio_ciclo)} a{" "}
                    {formatDate(fatura.data_fechamento)} · vencimento{" "}
                    {formatDate(fatura.data_vencimento)}
                    {projetado
                      ? " · projeção, este ciclo ainda não existe como fatura"
                      : estadoSelecionado === "EM_FORMACAO"
                        ? " · valor parcial, o ciclo ainda não fechou"
                        : usarOficial
                          ? " · fatura oficial importada"
                          : " · valor calculado pelo sistema"}
                  </p>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                {estadoSelecionado && (
                  <Badge tone={toneEstado(estadoSelecionado)}>
                    {ESTADO_CICLO_LABELS[estadoSelecionado]}
                  </Badge>
                )}
                {podePagarEsteCiclo && !pagando && (
                  <button
                    type="button"
                    onClick={() => setPagando(true)}
                    className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground"
                  >
                    Pagar fatura
                  </button>
                )}
                {fatura?.status === "PAGA" && (
                  <span className="text-xs font-semibold text-emerald-600">Fatura paga</span>
                )}
              </div>
            </div>

            {projetado ? (
              <>
                <div className="mt-3 rounded-2xl bg-muted/50 p-4">
                  <p className="text-sm font-bold">Projeção</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Valor estimado com base nas parcelas e recorrências já conhecidas. Este ciclo
                    ainda não é uma fatura fechada e não pode ser pago.
                  </p>
                </div>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Metric label="Parcelas" value={formatCurrency(parcelasDoCiclo)} />
                  <Metric label="Recorrências" value={formatCurrency(recorrenciasProjetadas)} />
                  <Metric label="Valor previsto" value={formatCurrency(totalCiclo)} big />
                </div>
              </>
            ) : emFormacao ? (
              <>
                <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                  <Metric
                    label="Parcelas já comprometidas"
                    value={formatCurrency(parcelasDoCiclo)}
                  />
                  <Metric
                    label="Recorrências previstas"
                    value={formatCurrency(recorrenciasProjetadas)}
                  />
                  <Metric
                    label="Compras novas após fechamento"
                    value={formatCurrency(soma("normais"))}
                  />
                  <Metric
                    label="Total previsto até agora"
                    value={formatCurrency(totalCiclo)}
                    big
                  />
                </div>
                <p className="mt-2 text-[11px] text-muted-foreground">
                  Próxima fatura · Em formação: as parcelas já contratadas vêm da última fatura
                  confirmada e ainda podem entrar compras novas até o fechamento.
                </p>
              </>
            ) : (
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <Metric label="Compras normais" value={formatCurrency(soma("normais"))} />
                <Metric label="Parcelamentos" value={formatCurrency(soma("parceladas"))} />
                <Metric label="Recorrências" value={formatCurrency(soma("recorrentes"))} />
                {usarOficial && (
                  <>
                    <Metric label="Taxas e serviços" value={formatCurrency(soma("taxas"))} />
                    <Metric label="Créditos e estornos" value={formatCurrency(soma("creditos"))} />
                  </>
                )}
                <Metric
                  label={usarOficial ? "Total oficial da fatura" : "Total do ciclo"}
                  value={formatCurrency(totalCiclo)}
                  big
                />
              </div>
            )}


            {usarOficial && (
              <p className="mt-2 text-[11px] text-muted-foreground">
                Resumo montado a partir dos {itensDoCiclo.length} lançamentos da fatura importada e
                confirmada — inclui parcelas de séries antigas, taxas e estornos sem compra
                registrada neste ciclo.
              </p>
            )}

            {podePagarEsteCiclo && pagando && (
              <div className="mt-4 grid gap-3 rounded-2xl bg-muted/50 p-4 sm:grid-cols-3">
                <Field label="Conta de origem">
                  <select
                    className={inputClass}
                    value={conta}
                    onChange={(e) => setConta(e.target.value)}
                    aria-label="Conta bancária de origem"
                  >
                    <option value="">Selecione</option>
                    {contasParaPagar.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.banco} · {a.nome_conta} ({formatCurrency(Number(a.saldo_atual))})
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Data do pagamento">
                  <input
                    type="date"
                    className={inputClass}
                    value={dataPagamento}
                    onChange={(e) => setDataPagamento(e.target.value)}
                  />
                </Field>
                <Field label="Valor">
                  <input
                    className={inputClass}
                    value={formatCurrency(Number(fatura?.valor_total) || 0)}
                    readOnly
                    aria-label="Valor da fatura"
                  />
                </Field>
                <div className="flex flex-wrap items-end gap-3 sm:col-span-3">
                  <button
                    type="button"
                    onClick={() => void confirmarPagamento()}
                    disabled={pagar.isPending}
                    className="rounded-full bg-primary px-5 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-60"
                  >
                    {pagar.isPending ? "Pagando..." : "Confirmar pagamento"}
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPagando(false);
                      setErro("");
                    }}
                    className="rounded-full border border-border px-5 py-2 text-xs font-semibold text-muted-foreground"
                  >
                    Cancelar
                  </button>
                  <p className="text-[11px] text-muted-foreground">
                    O pagamento gera apenas uma movimentação bancária de pagamento de cartão — nunca
                    uma nova compra.
                  </p>
                </div>
                {erro && (
                  <p className="text-xs font-semibold text-destructive sm:col-span-3">{erro}</p>
                )}
              </div>
            )}
          </Card>
        </>
      )}

      {/* Limite e capacidade: uma linha de leitura rápida. */}
      <Card className="mt-4">
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
          <Metric
            label="Limite disponível"
            value={formatCurrency(disponivel)}
            hint={`Utilizado ${formatCurrency(utilizado)} de ${formatCurrency(limite)} · ${composicao.oficial ? "fatura oficial do ciclo" : "fatura estimada do ciclo"} ${formatCurrency(composicao.faturaAtual)} + parcelas futuras ${formatCurrency(composicao.parcelasFuturas)} + outras parcelas em aberto ${formatCurrency(composicao.outros)} + compras sem parcela ${formatCurrency(composicao.comprasSemParcela)}`}
            tone={disponivel < 0 ? "danger" : "ok"}
          />
          <Metric
            label="Parcelas futuras"
            value={formatCurrency(restanteParcelas)}
            hint="Soma das parcelas ainda não quitadas"
          />
          <Metric
            label="Recorrências previstas"
            value={`${formatCurrency(recorrenciasMensais)}/mês`}
            hint={`${recorrenciasAtivas} cobrança(s) ativa(s) neste cartão`}
          />
          <Metric label="Saldo nas contas do titular" value={formatCurrency(saldoContas)} />
          <Metric
            label="Sobra após pagar esta fatura"
            value={formatCurrency(capacidade)}
            tone={capacidade < 0 ? "danger" : "ok"}
            hint={statusPagamento}
          />
        </div>
        <div className="mt-3 h-2 w-full overflow-hidden rounded-full bg-muted">
          <div
            className={`h-full rounded-full ${TONE_DOTS[usageTone(uso)]}`}
            style={{ width: `${uso}%` }}
          />
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
          <Badge tone={statusTone}>{statusPagamento}</Badge>
          <Link
            to="/cartoes/$cardId/projecao"
            params={{ cardId: cartao.id }}
            className="text-xs font-semibold text-primary hover:underline"
          >
            Ver projeção completa
          </Link>
        </div>
      </Card>

      {/* Lançamentos do ciclo selecionado, agrupados por dia. */}
      <Card className="mt-4">
        <SectionTitle
          title="Lançamentos do ciclo"
          hint={
            usarOficial
              ? "Lista completa da fatura importada e confirmada."
              : "Compras, parcelas e recorrências registradas neste ciclo."
          }
        />
        <div className="mb-3">
          <SearchInput
            value={busca}
            onChange={setBusca}
            label="Buscar lançamento"
            placeholder="Estabelecimento ou descrição"
          />
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Tipo de lançamento">
            <select
              className={inputClass}
              value={filtroTipo}
              onChange={(e) => setFiltroTipo(e.target.value)}
              aria-label="Tipo de lançamento"
            >
              <option value="">Todos</option>
              <option value="normais">Normal</option>
              <option value="parceladas">Parcelada</option>
              <option value="recorrentes">Recorrente</option>
              {usarOficial && <option value="taxas">Taxa/serviço</option>}
              {usarOficial && <option value="creditos">Crédito/estorno</option>}
            </select>
          </Field>
          <Field label="Categoria">
            <select
              className={inputClass}
              value={filtroCategoria}
              onChange={(e) => setFiltroCategoria(e.target.value)}
              aria-label="Categoria"
            >
              <option value="">Todas</option>
              {(categorias ?? []).map((c) => (
                <option key={c.id} value={c.id}>
                  {c.nome}
                </option>
              ))}
            </select>
          </Field>
        </div>

        {filtradas.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Receipt className="size-5" />}
              title="Nenhum lançamento neste ciclo"
              description="Compras no cartão, parcelas e recorrências deste ciclo aparecem aqui assim que forem registradas."
            />
          </div>
        ) : (
          <div className="mt-4 space-y-4">
            {dias.map(([dia, itens]) => (
              <div key={dia}>
                <div className="flex items-center justify-between gap-3">
                  <p className="text-xs font-bold uppercase tracking-wide text-muted-foreground">
                    {dia === "sem-data" ? "Sem data" : formatDate(dia)}
                  </p>
                  <p className="text-xs font-semibold text-muted-foreground">
                    {formatCurrency(itens.reduce((acc, l) => acc + l.valor, 0))}
                  </p>
                </div>
                <ul className="mt-1 divide-y divide-border">
                  {itens.map((l) => (
                    <li key={l.id} className="flex items-start justify-between gap-3 py-2.5">
                      <span className="min-w-0">
                        <span className="flex flex-wrap items-center gap-2">
                          <span className="truncate text-sm font-semibold">
                            {l.estabelecimento}
                          </span>
                          {l.kind === "recorrentes" && (
                            <StatusBadge tone="ok">Recorrente</StatusBadge>
                          )}
                          {l.kind === "parceladas" && (
                            <StatusBadge tone="info">
                              {l.parcela !== "—" ? `Parcela ${l.parcela}` : "Parcelada"}
                            </StatusBadge>
                          )}
                          {(l.kind === "taxas" || l.kind === "creditos") && (
                            <StatusBadge tone="muted">{KIND_OFICIAL_LABELS[l.kind]}</StatusBadge>
                          )}
                          {projetado && <StatusBadge tone="warn">Projetado</StatusBadge>}
                        </span>
                        <span className="mt-0.5 block text-xs text-muted-foreground">
                          {categoriaNome(l.categoriaId)}
                        </span>
                      </span>
                      <span className="whitespace-nowrap text-sm font-bold">
                        {formatCurrency(l.valor)}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Card>

      {/* Área secundária: importações ficam fechadas por padrão. */}
      <details id="importacoes" className="mt-4">
        <summary className="cursor-pointer list-none rounded-2xl border border-border bg-card px-5 py-4 text-sm font-bold shadow-soft">
          Faturas importadas e ferramentas
          <span className="ml-2 text-xs font-normal text-muted-foreground">
            abrir importações deste cartão
          </span>
        </summary>
        <div className="mt-2">
          <CardStatementImports
            familyId={family.id}
            cardId={cartao.id}
            onImportar={() => setImportando(true)}
          />
        </div>
      </details>
    </div>
  );
}
