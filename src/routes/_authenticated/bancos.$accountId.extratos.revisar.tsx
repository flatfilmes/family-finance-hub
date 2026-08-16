/**
 * Revisão de extrato bancário em PÁGINA COMPLETA.
 *
 * O rascunho vem da leitura feita no navegador (nada foi gravado). Só ao
 * confirmar a revisão é que a importação e as ações escolhidas são
 * persistidas. Lançamentos futuros nunca viram movimentação realizada.
 */
import { useMemo, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, PrimaryButton, inputClass } from "@/components/page-header";
import { Badge, DetailHeader, Metric } from "@/components/detail-page";
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

export const Route = createFileRoute("/_authenticated/bancos/$accountId/extratos/revisar")({
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
    associadas: por("ASSOCIATE_EXISTING"),
    possiveis: rows.filter((l) => l.sugestao.matchStatus === "POSSIBLE_MATCH").length,
    novas: rows.filter((l) => l.sugestao.matchStatus === "NEW").length,
    tarifas: por("REGISTER_FEE"),
    cartao: por("MATCH_CARD_PAYMENT"),
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

  const ident = resumo.identificacao;

  return (
    <div className="mx-auto w-full max-w-[1400px] px-4 pb-32 pt-6">
      <DetailHeader
        backTo="/bancos"
        backLabel="Bancos"
        title="Revisar extrato"
        subtitle={`${conta?.banco ?? ident?.banco ?? "Conta bancária"} · ${conta?.nome_conta ?? ""}`}
        badges={
          <>
            {(resumo.periodoInicio || resumo.periodoFim) && (
              <Badge>
                Período{" "}
                {resumo.periodoInicio ? formatDate(resumo.periodoInicio) : "?"} –{" "}
                {resumo.periodoFim ? formatDate(resumo.periodoFim) : "?"}
              </Badge>
            )}
            {ident?.conta && <Badge>Conta {ident.conta}</Badge>}
            <Badge>{draft.nomeArquivo}</Badge>
            <Badge tone={saldoOk ? "ok" : "warn"}>
              {saldoOk ? "Saldo confere" : "Saldo a conferir"}
            </Badge>
          </>
        }
      />

      {draft.jaImportado && (
        <p className="mb-4 rounded-2xl bg-amber-500/15 p-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
          Este arquivo já foi importado nesta conta. Confirmar de novo não duplica lançamentos.
        </p>
      )}

      <div className="grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
        <Metric label="Saldo anterior" value={formatCurrency(resumo.saldoInicial ?? 0)} />
        <Metric label="Entradas" value={`+${formatCurrency(entradas)}`} />
        <Metric label="Saídas" value={`-${formatCurrency(saidas)}`} tone="danger" />
        <Metric label="Saldo final do extrato" value={formatCurrency(resumo.saldoFinal ?? 0)} />
        <Metric label="Saldo calculado" value={calculado === null ? "—" : formatCurrency(calculado)} />
        <Metric
          label="Diferença"
          value={diferenca === null ? "—" : formatCurrency(Math.abs(diferenca))}
          hint={saldoOk ? "STATEMENT_BALANCE_OK" : "STATEMENT_BALANCE_MISMATCH"}
          {...(saldoOk ? {} : { tone: "danger" as const })}
        />
      </div>

      <div className="mt-4 flex flex-wrap gap-2 text-[11px]">
        <Chip label="Movimentações realizadas" valor={contagem.total} />
        <Chip label="Associadas" valor={contagem.associadas} />
        <Chip label="Possíveis" valor={contagem.possiveis} />
        <Chip label="Novas" valor={contagem.novas} />
        <Chip label="Tarifas" valor={contagem.tarifas} />
        <Chip label="Pagamentos de cartão" valor={contagem.cartao} />
        <Chip label="Ignoradas" valor={contagem.ignoradas} />
        <Chip label="Futuras" valor={contagem.futuras} />
      </div>

      <Card className="mt-6 overflow-hidden p-0">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] text-left text-sm">
            <thead className="bg-muted/60">
              <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                <th className="px-4 py-3">Data</th>
                <th className="px-4 py-3">Descrição</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Situação</th>
                <th className="px-4 py-3">Associação</th>
                <th className="px-4 py-3 text-right">Valor</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((l, i) => (
                <tr key={`${l.descricaoOriginal}-${i}`} className="border-t border-border align-top">
                  <td className="whitespace-nowrap px-4 py-3 text-xs text-muted-foreground">
                    {l.data ? formatDate(l.data) : "—"}
                  </td>
                  <td className="px-4 py-3">
                    <span className="font-semibold">{l.descricaoOriginal}</span>
                    <span className="block text-[11px] text-muted-foreground">
                      {l.sugestao.motivo}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {MOVEMENT_KIND_LABELS[l.tipo]}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted-foreground">
                    {MATCH_LABELS[l.sugestao.matchStatus]}
                  </td>
                  <td className="px-4 py-3">
                    <select
                      aria-label={`Ação para ${l.descricaoOriginal}`}
                      className={inputClass}
                      value={l.acao}
                      onChange={(e) => setAcao(i, e.target.value as ReviewAction)}
                    >
                      {REVIEW_ACTIONS.map((a) => (
                        <option key={a} value={a}>
                          {REVIEW_ACTION_LABELS[a]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td
                    className={`whitespace-nowrap px-4 py-3 text-right font-bold ${
                      l.valor >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-destructive"
                    }`}
                  >
                    {l.valor >= 0 ? "+" : "-"}
                    {formatCurrency(Math.abs(l.valor))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      {futuros.length > 0 && (
        <Card className="mt-6">
          <h2 className="text-base font-bold">Próximos lançamentos</h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            Previstos pelo banco. Não entram no saldo realizado nem viram movimentação ao confirmar.
          </p>
          <ul className="mt-3 divide-y divide-border">
            {futuros.map((f, i) => (
              <li key={`${f.descricaoOriginal}-${i}`} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-24 text-xs text-muted-foreground">
                  {f.data ? formatDate(f.data) : "—"}
                </span>
                <span className="flex-1 font-semibold">{f.descricaoOriginal}</span>
                <Badge tone="warn">Futuro</Badge>
                <span className="w-32 text-right font-bold text-destructive">
                  -{formatCurrency(Math.abs(f.valor))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}

      <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex w-full max-w-[1400px] flex-wrap items-center gap-3">
          <p className="text-xs text-muted-foreground">
            <strong className="text-foreground">{contagem.total}</strong> movimentações realizadas ·{" "}
            {contagem.associadas} serão associadas · {criadas} serão criadas · {contagem.ignoradas}{" "}
            serão ignoradas · {contagem.futuras} futura(s) sem efeito
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
              {confirmar.isPending ? "Confirmando…" : "Confirmar revisão"}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Chip({ label, valor }: { label: string; valor: number }) {
  return (
    <span className="rounded-full bg-muted px-3 py-1 font-semibold text-muted-foreground">
      {label}: <strong className="text-foreground">{valor}</strong>
    </span>
  );
}
