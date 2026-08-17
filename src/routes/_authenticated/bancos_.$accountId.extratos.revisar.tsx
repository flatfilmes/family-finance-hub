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
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
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
import { useBankStatementItems } from "@/hooks/useBankStatements";
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
  buildExistingMovementKeys,
  buildExistingMovementIndex,
  classificarDuplicados,
  type ReviewAction,
  type StatementDraftRow,
} from "@/lib/bank-statements";
import { clearStatementDraft, loadStatementDraft } from "@/lib/bank-statements/draft";
import { toCanonicalStatement } from "@/lib/bank-statements/canonical";
import { validateStatement } from "@/lib/bank-statements/validate";

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
        content:
          "Revisão completa do extrato: entradas, saídas, associações e lançamentos futuros.",
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
  // Extratos sobrepostos: o que já foi lido em outro documento não repete.
  const { data: itensExistentes } = useBankStatementItems(accountId);

  const draft = useMemo(() => loadStatementDraft(accountId), [accountId]);
  const conta = (accounts ?? []).find((a) => a.id === accountId) ?? null;

  // TRAVA DE QUALIDADE: extrato lido com período, saldo ou soma inconsistentes
  // não pode ser gravado. A conferência é feita sobre o documento canônico.
  const validacao = useMemo(() => {
    if (!draft) return null;
    const canonical = toCanonicalStatement(draft.resumo, {
      statementId: draft.fingerprint ?? draft.nomeArquivo,
      bank: draft.resumo.identificacao?.banco ?? null,
      account: draft.resumo.identificacao?.conta ?? null,
    });
    return validateStatement(canonical);
  }, [draft]);
  const bloqueado = validacao?.status === "PARSED_STATEMENT_INVALID";

  const [linhas, setLinhas] = useState<StatementDraftRow[] | null>(null);
  const [filtro, setFiltro] = useState<Filtro>("TODOS");

  const voltar = () => navigate({ to: "/bancos/$accountId", params: { accountId } });

  const rows = useMemo<StatementDraftRow[]>(() => {
    if (linhas) return linhas;
    if (!draft) return [];
    // IDENTIDADE DE LINHA: sourceId do parser primeiro; matching composto com
    // ordinal de ocorrência depois. Repetição legítima nunca é descartada.
    const canonicalRows = toCanonicalStatement(draft.resumo, {
      statementId: draft.fingerprint ?? draft.nomeArquivo,
      accountId,
    }).transactions;
    const jaExistentes = buildExistingMovementIndex(itensExistentes ?? []);
    const duplicados = classificarDuplicados(
      draft.resumo.movimentos,
      jaExistentes,
      canonicalRows.map((t) => t.sourceId),
    );
    return draft.resumo.movimentos.map((m, idx) => {
      const sugestao = reconcileMovement(m, {
        accountId,
        purchases: purchases ?? [],
        invoices: invoices ?? [],
        accounts: accounts ?? [],
        transactions: transactions ?? [],
        incomes: incomes ?? [],
      });
      const dedupe = duplicados[idx];
      // Sem ALVO CONCRETO não existe duplicata: o movimento segue para o ledger.
      if (dedupe?.duplicado && dedupe.matchedTargetId) {
        return {
          ...m,
          sugestao: {
            ...sugestao,
            matchStatus: "MATCHED" as const,
            motivo: `${dedupe.reason} (alvo ${dedupe.matchedTargetId.slice(0, 8)})`,
          },
          acao: "IGNORE" as ReviewAction,
          incluir: false,
        };
      }
      return {
        ...m,
        sugestao,
        acao: sugestao.reviewAction,
        incluir: !ACOES_SEM_EFEITO.includes(sugestao.reviewAction),
      };
    });
  }, [
    linhas,
    draft,
    accountId,
    purchases,
    invoices,
    accounts,
    transactions,
    incomes,
    itensExistentes,
  ]);

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
    resumo.saldoInicial === null
      ? null
      : Number((resumo.saldoInicial + entradas - saidas).toFixed(2));
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
    resumo.saldoReferenciaAtual
      ? `Saldo atual informado no documento em ${formatDate(
          resumo.saldoReferenciaAtual.data,
        )}: ${formatCurrency(resumo.saldoReferenciaAtual.saldo)} (fora do período)`
      : null,
    `Arquivo ${draft.nomeArquivo}`,
  ].filter(Boolean) as string[];

  const resumoLinha = [
    `${contagem.total} movimentaç${contagem.total === 1 ? "ão" : "ões"}`,
    contagem.entradas > 0 ? `${contagem.entradas} entradas` : null,
    contagem.saidas > 0 ? `${contagem.saidas} saídas` : null,
    contagem.futuras > 0 ? `${contagem.futuras} futura${contagem.futuras > 1 ? "s" : ""}` : null,
  ].filter(Boolean) as string[];

  // Agrupamento por dia (apresentação): saldo corrido derivado do próprio
  // extrato, comparado com o "Saldo do dia" impresso pelo banco.
  const dias = agruparPorDia(indexadas, resumo.saldoInicial, resumo.checkpoints ?? []).filter((d) =>
    d.itens.some(({ i }) => visiveis.some((v) => v.i === i)),
  );

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

      <div className="-mt-3 mb-6 flex flex-wrap items-center gap-3">
        <p className="text-xs text-muted-foreground">{metadata.join(" · ")}</p>
        <Link
          to="/bancos/$accountId/diagnostico-parser"
          params={{ accountId }}
          className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
        >
          Ver diagnóstico
        </Link>
      </div>


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

      {/* Extrato por dia */}
      <div className="mt-4 space-y-4">
        {dias.map((dia) => (
          <Card key={dia.data ?? "sem-data"} className="p-0">
            <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 sm:px-5">
              <h3 className="text-sm font-extrabold uppercase tracking-wide">
                {dia.data ? formatDiaCurto(dia.data) : "Sem data"}
              </h3>
              <span className="text-[11px] text-muted-foreground">
                {dia.itens.length} lançamento{dia.itens.length === 1 ? "" : "s"}
              </span>
            </div>

            <ul className="divide-y divide-border">
              {dia.itens
                .filter(({ i }) => visiveis.some((v) => v.i === i))
                .map(({ l, i }) => {
                  const { principal, detalhes } = descreverLinha(l);
                  const atencao = l.sugestao.matchStatus === "POSSIBLE_MATCH";
                  return (
                    <li
                      key={`${l.descricaoOriginal}-${i}`}
                      className={`px-4 py-3 sm:px-5 ${atencao ? "bg-amber-500/5" : ""}`}
                    >
                      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
                        <div className="min-w-0 sm:flex-1">
                          <p className="font-semibold">{principal}</p>
                          {detalhes.length > 0 && (
                            <p className="mt-0.5 text-[11px] text-muted-foreground">
                              {detalhes.join(" · ")}
                            </p>
                          )}
                          <div className="mt-2 flex flex-wrap items-center gap-2">
                            <Badge>{tipoLegivel(l)}</Badge>
                            <Badge tone={SITUACAO_TONE[l.sugestao.matchStatus]}>
                              {SITUACAO_CURTA[l.sugestao.matchStatus]}
                            </Badge>
                            {associacaoLegivel(l) && (
                              <span className="text-[11px] text-muted-foreground">
                                Associado a: {associacaoLegivel(l)}
                              </span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center justify-between gap-3 sm:justify-end">
                          <p
                            className={`whitespace-nowrap text-base font-extrabold tabular-nums ${
                              l.valor >= 0
                                ? "text-emerald-600 dark:text-emerald-400"
                                : "text-destructive"
                            }`}
                          >
                            {l.valor >= 0 ? "+ " : "- "}
                            {formatCurrency(Math.abs(l.valor))}
                          </p>
                          <div className="shrink-0">
                            <MenuAcao linha={l} onChange={(a) => setAcao(i, a)} />
                          </div>
                        </div>
                      </div>
                    </li>
                  );
                })}
            </ul>

            {dia.saldo !== null && (
              <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 bg-muted/40 px-4 py-2.5 text-xs sm:px-5">
                <span className="text-muted-foreground">Saldo do dia</span>
                <span className="flex items-center gap-2">
                  <strong className="tabular-nums">{formatCurrency(dia.saldo)}</strong>
                  {dia.banco !== null &&
                    (dia.confere ? (
                      <span className="inline-flex items-center gap-1 font-semibold text-emerald-600 dark:text-emerald-400">
                        <Check className="size-3" /> Confere
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1 font-semibold text-amber-700 dark:text-amber-400">
                        <TriangleAlert className="size-3" /> Banco {formatCurrency(dia.banco)}
                      </span>
                    ))}
                </span>
              </div>
            )}
          </Card>
        ))}

        {dias.length === 0 && (
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

      {bloqueado && (
        <Card>
          <div className="flex items-start gap-3">
            <TriangleAlert className="mt-0.5 size-5 shrink-0 text-destructive" />
            <div>
              <h2 className="font-bold text-destructive">Leitura do extrato inválida</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Este documento não pode ser gravado: o que foi lido não fecha com o próprio
                extrato. Corrija o arquivo ou abra o diagnóstico de importação.
              </p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                {validacao?.problems.map((p) => <li key={p}>{p}</li>)}
              </ul>
            </div>
          </div>
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">{contagem.total}</strong> movimentações ·{" "}
            {contagem.total - contagem.ignoradas} serão processadas · {contagem.ignoradas} ignoradas
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
              disabled={confirmar.isPending || rows.length === 0 || bloqueado}
              onClick={() => confirmar.mutate()}
            >
              {bloqueado
                ? "Leitura inválida"
                : confirmar.isPending
                ? "Confirmando…"
                : `Confirmar ${contagem.total} movimentaç${contagem.total === 1 ? "ão" : "ões"}`}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Situação em uma palavra — nada de texto técnico longo. */
const SITUACAO_CURTA: Record<keyof typeof MATCH_LABELS, string> = {
  MATCHED: "Associado",
  POSSIBLE_MATCH: "Possível",
  DIVERGENT: "Divergente",
  NEW: "Novo",
  IGNORED: "Ignorado",
};

const SITUACAO_TONE: Record<keyof typeof MATCH_LABELS, "muted" | "ok" | "warn" | "danger"> = {
  MATCHED: "ok",
  POSSIBLE_MATCH: "warn",
  DIVERGENT: "danger",
  NEW: "muted",
  IGNORED: "muted",
};

/** Nunca mostrar UUID cru: só a entidade correspondente (UUID em DEV). */
function associacaoLegivel(l: StatementDraftRow) {
  const d = l.sugestao.debug;
  const par: [string | undefined, string][] = [
    [d.candidateTransaction, "Movimentação bancária"],
    [d.candidatePurchase, "Compra existente"],
    [d.candidateIncome, "Receita cadastrada"],
    [d.candidateInvoice, "Fatura de cartão"],
  ];
  const achou = par.find(([id]) => !!id);
  if (!achou) return null;
  return import.meta.env.DEV ? `${achou[1]} (${achou[0]?.slice(0, 8)}…)` : achou[1];
}

/** "03 AGO" — cabeçalho de dia no estilo extrato bancário. */
function formatDiaCurto(iso: string) {
  const [, mes, dia] = iso.split("-");
  const meses = [
    "JAN",
    "FEV",
    "MAR",
    "ABR",
    "MAI",
    "JUN",
    "JUL",
    "AGO",
    "SET",
    "OUT",
    "NOV",
    "DEZ",
  ];
  return `${dia} ${meses[Number(mes) - 1] ?? ""}`.trim();
}

type DiaExtrato = {
  data: string | null;
  itens: { l: StatementDraftRow; i: number }[];
  /** Saldo corrido do dia (apresentação), derivado do saldo anterior. */
  saldo: number | null;
  /** Saldo do dia impresso pelo banco, quando existir. */
  banco: number | null;
  confere: boolean;
};

/** Agrupa a revisão por dia e deriva o saldo de fechamento de cada dia. */
function agruparPorDia(
  indexadas: { l: StatementDraftRow; i: number }[],
  saldoInicial: number | null,
  checkpoints: { data: string; saldo: number }[],
): DiaExtrato[] {
  const mapa = new Map<string, { l: StatementDraftRow; i: number }[]>();
  for (const item of indexadas) {
    const chave = item.l.data ?? "";
    const atual = mapa.get(chave);
    if (atual) atual.push(item);
    else mapa.set(chave, [item]);
  }
  const chaves = [...mapa.keys()].sort((a, b) =>
    a === "" ? 1 : b === "" ? -1 : a.localeCompare(b),
  );

  let corrente = saldoInicial;
  return chaves.map((chave) => {
    const itens = mapa.get(chave) ?? [];
    if (corrente !== null) {
      corrente = Number((corrente + itens.reduce((a, x) => a + x.l.valor, 0)).toFixed(2));
    }
    const banco = checkpoints.find((c) => c.data === chave)?.saldo ?? null;
    return {
      data: chave || null,
      itens,
      saldo: chave ? corrente : null,
      banco,
      confere: banco !== null && corrente !== null && Math.abs(banco - corrente) <= 0.02,
    };
  });
}

/** Um termo da equação do resumo. O valor nunca é truncado. */
function Termo({
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
      className={`flex items-baseline justify-between gap-3 rounded-xl px-3 py-2 lg:block lg:flex-none lg:px-0 lg:py-0 ${
        destaque ? "bg-primary/10 lg:bg-transparent" : ""
      }`}
    >
      <p className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </p>
      <p
        className={`whitespace-nowrap text-right text-lg font-extrabold tabular-nums lg:mt-1 lg:text-left lg:text-2xl ${
          tone === "ok"
            ? "text-emerald-600 dark:text-emerald-400"
            : tone === "danger"
              ? "text-destructive"
              : destaque
                ? "text-primary"
                : ""
        }`}
      >
        {valor}
      </p>
    </div>
  );
}

/** Operador da equação: visível também no mobile, alinhado à esquerda. */
function Operador({ sinal }: { sinal: string }) {
  return (
    <span
      aria-hidden
      className="px-3 text-sm font-extrabold text-muted-foreground lg:px-0 lg:pb-1 lg:text-xl"
    >
      {sinal}
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
