/**
 * Revisão de extrato bancário em PÁGINA COMPLETA.
 *
 * O rascunho vem da leitura feita no navegador (nada foi gravado). Só ao
 * confirmar a revisão é que a importação e as ações escolhidas são
 * persistidas. Lançamentos futuros nunca viram movimentação realizada.
 *
 * Esta tela é apenas apresentação: nenhum cálculo, parser ou conciliação
 * é alterado aqui.
 */
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowRight, Check, ChevronDown, TriangleAlert } from "lucide-react";
import { Card, PrimaryButton } from "@/components/page-header";
import { Badge, DetailHeader } from "@/components/detail-page";
import { NoFamily } from "@/components/no-family";
import { EmptyState } from "@/components/empty-state";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useCardInvoices } from "@/hooks/useCardInvoices";
import { useTransactions } from "@/hooks/useTransactions";
import { usePurchases } from "@/hooks/usePurchases";
import { useIncomes } from "@/hooks/useFinanceData";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";
import {
  ACOES_SEM_EFEITO,
  MATCH_LABELS,
  MOVEMENT_KIND_LABELS,
  REVIEW_ACTIONS,
  REVIEW_ACTION_LABELS,
  confirmBankStatementImport,
  createBankStatementImport,
  reconcileMovement,
  type ReviewAction,
  type StatementDraftRow,
} from "@/lib/bank-statements";
import { clearStatementDraft, loadStatementDraft } from "@/lib/bank-statements/draft";

export const Route = createFileRoute("/_authenticated/bancos_/$accountId/extratos/revisar")({
  head: () => ({
    meta: [
      { title: "Revisar extrato bancário — Família Finance AI" },
      {
        name: "description",
        content:
          "Confira lançamento a lançamento o extrato importado antes de gravar qualquer movimentação na conta.",
      },
      { property: "og:title", content: "Revisar extrato bancário — Família Finance AI" },
      {
        property: "og:description",
        content: "Revisão completa do extrato: entradas, saídas, associações e lançamentos futuros.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RevisarExtrato,
});

/** Rótulos curtos para a coluna de ação (linguagem de usuário final). */
const ACAO_CURTA: Record<ReviewAction, string> = {
  ASSOCIATE_EXISTING: "Associar",
  CREATE_TRANSACTION: "Criar movimentação",
  CREATE_PURCHASE: "Criar compra",
  MATCH_INCOME: "Registrar receita",
  MATCH_TRANSFER: "Transferência",
  MATCH_CARD_PAYMENT: "Pagamento de cartão",
  REGISTER_FEE: "Registrar tarifa",
  REGISTER_REFUND: "Registrar estorno",
  IGNORE: "Ignorar",
};

type Filtro = "TODOS" | "ENTRADAS" | "SAIDAS" | "ASSOCIADOS" | "NOVOS" | "ATENCAO" | "FUTUROS";

const FILTROS: { id: Filtro; label: string }[] = [
  { id: "TODOS", label: "Todos" },
  { id: "ENTRADAS", label: "Entradas" },
  { id: "SAIDAS", label: "Saídas" },
  { id: "ASSOCIADOS", label: "Associados" },
  { id: "NOVOS", label: "Novos" },
  { id: "ATENCAO", label: "Precisa de atenção" },
  { id: "FUTUROS", label: "Futuros" },
];

/** Quebra a descrição bruta em linha principal e detalhes (hora, documento). */
function descreverLinha(l: StatementDraftRow) {
  const bruto = l.descricaoOriginal.replace(/\((\+|-)\)/g, " ").trim();
  const hora = bruto.match(/\b\d{2}:\d{2}\b/)?.[0] ?? null;
  const documento = bruto.match(/\b\d{8,}\b/)?.[0] ?? null;
  const principal =
    bruto
      .replace(/\b\d{2}:\d{2}\b/g, " ")
      .replace(/\b\d{8,}\b/g, " ")
      .replace(/^\d{2}\/\d{2}(\/\d{2,4})?/, " ")
      .replace(/\s{2,}/g, " ")
      .trim() || bruto;
  const detalhes = [l.sugestao.motivo, hora, documento ? `documento ${documento}` : null].filter(
    Boolean,
  ) as string[];
  return { principal, detalhes };
}

/** Natureza mais precisa que "saída genérica" quando já sabemos classificar. */
function tipoLegivel(l: StatementDraftRow) {
  if (l.acao === "MATCH_CARD_PAYMENT") return "Pagamento de cartão";
  if (l.tipo === "TARIFA") return "Tarifa / IOF";
  return MOVEMENT_KIND_LABELS[l.tipo];
}

function RevisarExtrato() {
  const { accountId } = Route.useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const { data: family } = useFamily();
  const familyId = family?.id ?? "";

  const { data: accounts } = useBankAccounts(familyId);
  const { data: purchases } = usePurchases(familyId);
  const { data: invoices } = useCardInvoices(familyId);
  const { data: transactions } = useTransactions(familyId);
  const { data: incomes } = useIncomes(familyId);

  const draft = useMemo(() => loadStatementDraft(accountId), [accountId]);
  const conta = (accounts ?? []).find((a) => a.id === accountId) ?? null;

  const [linhas, setLinhas] = useState<StatementDraftRow[] | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("TODOS");

  const voltar = () => navigate({ to: "/bancos/$accountId", params: { accountId } });

  const rows = useMemo<StatementDraftRow[]>(() => {
    if (linhas) return linhas;
    if (!draft) return [];
    return draft.resumo.movimentos.map((m) => {
      const sugestao = reconcileMovement(m, {
        accountId,
        purchases: purchases ?? [],
        invoices: invoices ?? [],
        accounts: accounts ?? [],
        transactions: transactions ?? [],
        incomes: incomes ?? [],
      });
      return {
        ...m,
        sugestao,
        acao: sugestao.reviewAction,
        incluir: !ACOES_SEM_EFEITO.includes(sugestao.reviewAction),
      };
    });
  }, [linhas, draft, accountId, purchases, invoices, accounts, transactions, incomes]);

  const confirmar = useMutation({
    mutationFn: async () => {
      const imp = await createBankStatementImport({
        familyId,
        bankAccountId: accountId,
        memberId: conta?.member_id ?? null,
        nomeArquivo: draft!.nomeArquivo,
        formato: draft!.formato,
        parser: draft!.resumo.parser,
        createdBy: user?.id ?? null,
        fingerprint: draft!.fingerprint,
        resumo: draft!.resumo,
        linhas: rows,
      });
      return confirmBankStatementImport(imp.id);
    },
    onSuccess: (r) => {
      toast.success(
        `${r.criadas} lançamento(s) criado(s), ${r.associadas} associado(s), ${r.ignoradas} ignorado(s).`,
      );
      clearStatementDraft();
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", familyId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", familyId] });
      queryClient.invalidateQueries({ queryKey: ["purchases", familyId] });
      queryClient.invalidateQueries({ queryKey: ["card-invoices", familyId] });
      queryClient.invalidateQueries({ queryKey: ["bank-statement-imports", accountId] });
      voltar();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (!family) return <NoFamily />;

  if (!draft) {
    return (
      <div className="mx-auto w-full max-w-5xl px-4 py-8">
        <EmptyState
          title="Nenhum extrato em revisão"
          description="Envie novamente o PDF do extrato na página da conta para revisar os lançamentos."
          action={
            <PrimaryButton type="button" onClick={voltar}>
              Voltar para a conta
            </PrimaryButton>
          }
        />
      </div>
    );
  }

  const resumo = draft.resumo;
  const futuros = resumo.futuros ?? [];
  const entradas = rows.filter((l) => l.valor > 0).reduce((a, l) => a + l.valor, 0);
  const saidas = rows.filter((l) => l.valor < 0).reduce((a, l) => a + Math.abs(l.valor), 0);
  const calculado =
    resumo.saldoInicial === null ? null : Number((resumo.saldoInicial + entradas - saidas).toFixed(2));
  const diferenca =
    calculado === null || resumo.saldoFinal === null
      ? null
      : Number((resumo.saldoFinal - calculado).toFixed(2));
  const saldoOk = diferenca !== null && Math.abs(diferenca) <= 0.02;

  const por = (acao: ReviewAction) => rows.filter((l) => l.acao === acao).length;
  const contagem = {
    total: rows.length,
    entradas: rows.filter((l) => l.valor > 0).length,
    saidas: rows.filter((l) => l.valor < 0).length,
    associadas: por("ASSOCIATE_EXISTING"),
    possiveis: rows.filter((l) => l.sugestao.matchStatus === "POSSIBLE_MATCH").length,
    novas: rows.filter((l) => l.sugestao.matchStatus === "NEW").length,
    ignoradas: por("IGNORE"),
    futuras: futuros.length,
  };
  const criadas = rows.filter(
    (l) => !ACOES_SEM_EFEITO.includes(l.acao) && l.acao !== "IGNORE",
  ).length;

  const setAcao = (i: number, acao: ReviewAction) =>
    setLinhas(
      rows.map((r, idx) =>
        idx === i ? { ...r, acao, incluir: !ACOES_SEM_EFEITO.includes(acao) } : r,
      ),
    );

  const indexadas = rows.map((l, i) => ({ l, i }));
  const visiveis =
    filtro === "FUTUROS"
      ? []
      : indexadas.filter(({ l }) => {
          switch (filtro) {
            case "ENTRADAS":
              return l.valor > 0;
            case "SAIDAS":
              return l.valor < 0;
            case "ASSOCIADOS":
              return l.acao === "ASSOCIATE_EXISTING" || l.sugestao.matchStatus === "MATCHED";
            case "NOVOS":
              return l.sugestao.matchStatus === "NEW";
            case "ATENCAO":
              return (
                l.sugestao.matchStatus === "POSSIBLE_MATCH" ||
                l.sugestao.matchStatus === "DIVERGENT"
              );
            default:
              return true;
          }
        });

  const ident = resumo.identificacao;
  const metadata = [
    ident?.conta ? `Conta ${ident.conta}` : null,
    resumo.periodoInicio || resumo.periodoFim
      ? `Período ${resumo.periodoInicio ? formatDate(resumo.periodoInicio) : "?"} – ${
          resumo.periodoFim ? formatDate(resumo.periodoFim) : "?"
        }`
      : null,
    `Arquivo ${draft.nomeArquivo}`,
  ].filter(Boolean) as string[];

  const resumoLinha = [
    `${contagem.total} movimentaç${contagem.total === 1 ? "ão" : "ões"}`,
    contagem.entradas > 0 ? `${contagem.entradas} entradas` : null,
    contagem.saidas > 0 ? `${contagem.saidas} saídas` : null,
    contagem.associadas > 0 ? `${contagem.associadas} associadas` : null,
    contagem.novas > 0 ? `${contagem.novas} novas` : null,
    contagem.possiveis > 0 ? `${contagem.possiveis} a conferir` : null,
    contagem.futuras > 0 ? `${contagem.futuras} futura${contagem.futuras > 1 ? "s" : ""}` : null,
  ].filter(Boolean) as string[];

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-36 pt-6">
      <DetailHeader
        backTo="/bancos"
        backLabel="Bancos"
        title="Revisar extrato"
        subtitle={`${conta?.banco ?? ident?.banco ?? "Conta bancária"}${
          conta?.nome_conta ? ` · ${conta.nome_conta}` : ""
        }`}
      />

      <p className="-mt-3 mb-6 text-xs text-muted-foreground">{metadata.join(" · ")}</p>

      {draft.jaImportado && (
        <p className="mb-4 rounded-2xl bg-amber-500/15 p-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
          Este arquivo já foi importado nesta conta. Confirmar de novo não duplica lançamentos.
        </p>
      )}

      {/* Resumo do extrato: equação única + conferência no mesmo bloco */}
      <Card>
        <h2 className="text-base font-bold">Resumo do extrato</h2>

        <div className="mt-4 flex flex-col gap-1 lg:flex-row lg:flex-wrap lg:items-end lg:gap-4">
          <Termo label="Saldo anterior" valor={formatCurrency(resumo.saldoInicial ?? 0)} />
          <Operador sinal="+" />
          <Termo label="Entradas" valor={formatCurrency(entradas)} tone="ok" />
          <Operador sinal="−" />
          <Termo label="Saídas" valor={formatCurrency(saidas)} tone="danger" />
          <Operador sinal="=" />
          <Termo label="Saldo final" valor={formatCurrency(resumo.saldoFinal ?? 0)} destaque />
        </div>

        <div className="mt-5 border-t border-border pt-4">
          <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Conferência com o banco
          </p>
          <dl className="mt-2 space-y-1.5 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Saldo informado pelo banco</dt>
              <dd className="font-bold tabular-nums">
                {resumo.saldoFinal === null ? "—" : formatCurrency(resumo.saldoFinal)}
              </dd>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
              <dt className="text-muted-foreground">Diferença</dt>
              <dd className={`font-bold tabular-nums ${saldoOk ? "" : "text-destructive"}`}>
                {diferenca === null ? "—" : formatCurrency(Math.abs(diferenca))}
              </dd>
            </div>
          </dl>
          <p
            className={`mt-3 inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
              saldoOk
                ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
            }`}
          >
            {saldoOk ? <Check className="size-3.5" /> : <TriangleAlert className="size-3.5" />}
            {saldoOk ? "Saldo confere" : "Saldo não confere"}
          </p>
        </div>
      </Card>


      {/* Resumo dos lançamentos + filtros */}
      <p className="mt-6 text-sm font-semibold text-muted-foreground">{resumoLinha.join(" · ")}</p>

      <div className="mt-3 flex flex-wrap gap-2">
        {FILTROS.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFiltro(f.id)}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold transition-colors ${
              filtro === f.id
                ? "bg-primary text-primary-foreground"
                : "bg-muted text-muted-foreground hover:text-foreground"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* Tabela (desktop) */}
      <Card className="mt-4 hidden overflow-hidden p-0 md:block">
        <div className="w-full overflow-x-auto">
          <table className="w-full min-w-[1040px] table-fixed text-left text-sm">
            <colgroup>
              <col className="w-[104px]" />
              <col />
              <col className="w-[150px]" />
              <col className="w-[170px]" />
              <col className="w-[190px]" />
              <col className="w-[130px]" />
              <col className="w-[210px]" />
            </colgroup>
            <thead className="bg-muted/60">
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3">Associação</th>
                <th className="px-4 py-3 text-right">Valor</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {visiveis.map(({ l, i }) => {
                const { principal, detalhes } = descreverLinha(l);
                const atencao = l.sugestao.matchStatus === "POSSIBLE_MATCH";
                return (
                  <tr
                    key={`${l.descricaoOriginal}-${i}`}
                    className={`border-t border-border align-top ${atencao ? "bg-amber-500/5" : ""}`}
                  >
                    <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                      {l.data ? formatDate(l.data) : "—"}
                    </td>
                    <td className="px-4 py-3">
                      <p className="font-semibold">{principal}</p>
                      {detalhes.length > 0 && (
                        <p className="mt-0.5 text-[11px] text-muted-foreground">
                          {detalhes.join(" · ")}
                        </p>
                      )}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">{tipoLegivel(l)}</td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {MATCH_LABELS[l.sugestao.matchStatus]}
                    </td>
                    <td className="px-4 py-3 text-xs text-muted-foreground">
                      {l.sugestao.debug.candidateTransaction ??
                        l.sugestao.debug.candidatePurchase ??
                        l.sugestao.debug.candidateIncome ??
                        l.sugestao.debug.candidateInvoice ??
                        (atencao ? "Possível correspondência" : "—")}
                    </td>
                    <td
                      className={`whitespace-nowrap px-4 py-3 text-right font-bold ${
                        l.valor >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                      }`}
                    >
                      {l.valor >= 0 ? "+" : "-"}
                      {formatCurrency(Math.abs(l.valor))}
                    </td>
                    <td className="px-4 py-3">
                      <MenuAcao linha={l} onChange={(a) => setAcao(i, a)} />
                    </td>
                  </tr>
                );
              })}
              {visiveis.length === 0 && (
                <tr className="border-t border-border">
                  <td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">
                    {filtro === "FUTUROS"
                      ? "Veja os lançamentos previstos na seção abaixo."
                      : "Nenhum lançamento neste filtro."}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {/* Cards (mobile) */}
      <div className="mt-4 space-y-3 md:hidden">
        {visiveis.map(({ l, i }) => {
          const { principal, detalhes } = descreverLinha(l);
          return (
            <Card key={`m-${l.descricaoOriginal}-${i}`} className="p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{principal}</p>
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    {(l.data ? formatDate(l.data) : "—") +
                      (detalhes.length ? ` · ${detalhes.join(" · ")}` : "")}
                  </p>
                </div>
                <p
                  className={`shrink-0 font-bold ${
                    l.valor >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                  }`}
                >
                  {l.valor >= 0 ? "+" : "-"}
                  {formatCurrency(Math.abs(l.valor))}
                </p>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-muted-foreground">
                <Badge>{tipoLegivel(l)}</Badge>
                <span>{MATCH_LABELS[l.sugestao.matchStatus]}</span>
              </div>
              <div className="mt-3">
                <MenuAcao linha={l} onChange={(a) => setAcao(i, a)} />
              </div>
            </Card>
          );
        })}
        {visiveis.length === 0 && (
          <p className="py-8 text-center text-sm text-muted-foreground">
            {filtro === "FUTUROS"
              ? "Veja os lançamentos previstos na seção abaixo."
              : "Nenhum lançamento neste filtro."}
          </p>
        )}
      </div>

      {futuros.length > 0 && (
        <Card className="mt-6">
          <details open={filtro === "FUTUROS"}>
            <summary className="cursor-pointer list-none">
              <span className="text-base font-bold">Próximos lançamentos</span>
              <span className="ml-2 text-xs text-muted-foreground">
                ({futuros.length}) — previstos pelo banco, sem efeito na confirmação
              </span>
            </summary>
            <ul className="mt-3 divide-y divide-border">
              {futuros.map((f, i) => (
                <li
                  key={`${f.descricaoOriginal}-${i}`}
                  className="flex items-center gap-3 py-2 text-sm"
                >
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">
                    {f.data ? formatDate(f.data) : "—"}
                  </span>
                  <span className="min-w-0 flex-1 truncate font-semibold">
                    {f.descricaoOriginal}
                  </span>
                  <Badge tone="warn">Futuro</Badge>
                  <span className="w-32 shrink-0 text-right font-bold text-destructive">
                    -{formatCurrency(Math.abs(f.valor))}
                  </span>
                </li>
              ))}
            </ul>
          </details>
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">{contagem.total}</strong> movimentações ·{" "}
            {contagem.associadas} serão associadas · {criadas} serão criadas · {contagem.ignoradas}{" "}
            serão ignoradas
            {contagem.futuras > 0 ? ` · ${contagem.futuras} futura(s) sem efeito` : ""}
          </p>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => {
                clearStatementDraft();
                voltar();
              }}
              className="rounded-full border border-border px-4 py-2 text-sm font-semibold text-muted-foreground hover:bg-muted"
            >
              Cancelar
            </button>
            <PrimaryButton
              type="button"
              disabled={confirmar.isPending || rows.length === 0}
              onClick={() => confirmar.mutate()}
            >
              {confirmar.isPending
                ? "Confirmando…"
                : `Confirmar ${contagem.total} movimentaç${contagem.total === 1 ? "ão" : "ões"}`}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Passo({
  label,
  valor,
  tone,
  destaque,
}: {
  label: string;
  valor: string;
  tone?: "ok" | "danger";
  destaque?: boolean;
}) {
  return (
    <div
      className={`min-w-0 flex-1 rounded-2xl px-4 py-3 ${
        destaque ? "bg-primary/10" : "bg-muted/50"
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`mt-1 truncate text-lg font-extrabold ${
          tone === "ok"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "danger"
              ? "text-destructive"
              : ""
        }`}
      >
        {valor}
      </p>
    </div>
  );
}

function Seta({ sinal }: { sinal: string }) {
  return (
    <span
      aria-hidden
      className="hidden shrink-0 items-center justify-center text-sm font-bold text-muted-foreground lg:flex"
    >
      {sinal === "=" ? <ArrowRight className="size-4" /> : sinal}
    </span>
  );
}

/** Ação principal contextual + menu com as demais opções. */
function MenuAcao({
  linha,
  onChange,
}: {
  linha: StatementDraftRow;
  onChange: (a: ReviewAction) => void;
}) {
  return (
    <details className="group relative">
      <summary className="flex cursor-pointer list-none items-center justify-between gap-2 rounded-full border border-border px-3 py-1.5 text-xs font-semibold hover:bg-muted">
        <span className="truncate">{ACAO_CURTA[linha.acao]}</span>
        <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" />
      </summary>
      <div className="absolute right-0 z-30 mt-1 w-60 overflow-hidden rounded-2xl border border-border bg-card p-1 shadow-lg">
        {REVIEW_ACTIONS.map((a) => (
          <button
            key={a}
            type="button"
            onClick={(e) => {
              onChange(a);
              (e.currentTarget.closest("details") as HTMLDetailsElement | null)?.removeAttribute(
                "open",
              );
            }}
            className={`flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-xs font-semibold hover:bg-muted ${
              a === linha.acao ? "text-primary" : "text-foreground"
            }`}
          >
            {a === linha.acao ? <Check className="size-3.5" /> : <span className="size-3.5" />}
            {REVIEW_ACTION_LABELS[a]}
          </button>
        ))}
      </div>
    </details>
  );
}
