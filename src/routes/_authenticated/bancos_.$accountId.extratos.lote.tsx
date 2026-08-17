/**
 * REVISÃO DE IMPORTAÇÃO EM LOTE.
 *
 * Cada arquivo do lote já foi lido isoladamente pelo parser (nenhum PDF foi
 * concatenado). Aqui apenas mostramos o resultado por arquivo, marcamos as
 * duplicidades entre documentos e confirmamos — statement por statement, de
 * forma atômica: se um arquivo falhar ao salvar, os outros continuam válidos.
 */
import { useMemo, useState } from "react";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Check, ChevronDown, TriangleAlert } from "lucide-react";
import { Card, PrimaryButton } from "@/components/page-header";
import { DetailHeader } from "@/components/detail-page";
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
  buildExistingMovementIndex,
  confirmBankStatementImport,
  createBankStatementImport,
  reconcileMovement,
  type ReviewAction,
  type StatementDraftRow,
} from "@/lib/bank-statements";
import {
  consolidateBatchCheckpoints,
  detectPeriodOverlaps,
  markDuplicatesAcrossBatch,
  sortBatchFiles,
  summarizeBatch,
  type BatchFile,
} from "@/lib/bank-statements/batch";
import {
  clearStatementBatchDraft,
  loadStatementBatchDraft,
  saveStatementBatchDraft,
} from "@/lib/bank-statements/batch-draft";
import { saveStatementDraft } from "@/lib/bank-statements/draft";

export const Route = createFileRoute("/_authenticated/bancos_/$accountId/extratos/lote")({
  head: () => ({
    meta: [
      { title: "Revisar importação em lote — Família Finance AI" },
      {
        name: "description",
        content:
          "Confira vários extratos bancários de uma vez: período, movimentos, duplicidades e erros antes de gravar.",
      },
      { property: "og:title", content: "Revisar importação em lote — Família Finance AI" },
      {
        property: "og:description",
        content: "Importe o histórico completo da conta enviando vários PDFs de uma só vez.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RevisarLote,
});

type Relatorio = {
  arquivos: number;
  statements: number;
  novos: number;
  existentes: number;
  duplicidades: number;
  checkpoints: number;
  erros: number;
};

function mesResumo(inicio: string | null, fim: string | null) {
  if (!inicio && !fim) return "Período não identificado";
  return `${inicio ? formatDate(inicio) : "?"} → ${fim ? formatDate(fim) : "?"}`;
}

function RevisarLote() {
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
  const { data: itensExistentes } = useBankStatementItems(accountId);

  const conta = accounts?.find((a) => a.id === accountId) ?? null;

  const [draft, setDraft] = useState(() => loadStatementBatchDraft(accountId));
  const [aberto, setAberto] = useState<string | null>(null);
  const [relatorio, setRelatorio] = useState<Relatorio | null>(null);

  const arquivos = useMemo(() => sortBatchFiles(draft?.arquivos ?? []), [draft]);
  const validos = arquivos.filter((f) => f.status === "OK" && f.parsed);
  const comErro = arquivos.filter((f) => f.status !== "OK");

  const chavesExistentes = useMemo(
    () => buildExistingMovementIndex(itensExistentes ?? []),
    [itensExistentes],
  );
  const duplicados = useMemo(
    () => markDuplicatesAcrossBatch(arquivos, chavesExistentes),
    [arquivos, chavesExistentes],
  );
  const checkpoints = useMemo(() => consolidateBatchCheckpoints(arquivos), [arquivos]);
  const sobreposicoes = useMemo(() => detectPeriodOverlaps(arquivos), [arquivos]);
  const resumo = useMemo(
    () => summarizeBatch(arquivos, duplicados, checkpoints),
    [arquivos, duplicados, checkpoints],
  );

  /** Conciliação por arquivo — mesma regra da revisão individual. */
  const linhasDoArquivo = (f: BatchFile): StatementDraftRow[] => {
    const marcas = duplicados[f.id] ?? [];
    return (f.parsed?.movimentos ?? []).map((m, idx) => {
      const sugestao = reconcileMovement(m, {
        accountId,
        purchases: purchases ?? [],
        invoices: invoices ?? [],
        accounts: accounts ?? [],
        transactions: transactions ?? [],
        incomes: incomes ?? [],
      });
      if (marcas[idx]) {
        return {
          ...m,
          sugestao: {
            ...sugestao,
            matchStatus: "MATCHED" as const,
            motivo: "Já lido em outro extrato desta conta (período sobreposto).",
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
  };

  const confirmar = useMutation({
    mutationFn: async () => {
      const rel: Relatorio = {
        arquivos: arquivos.length,
        statements: 0,
        novos: 0,
        existentes: 0,
        duplicidades: 0,
        checkpoints: 0,
        erros: comErro.length,
      };
      for (const f of validos) {
        const linhas = linhasDoArquivo(f);
        try {
          // Atômico por statement: importação + itens + checkpoints juntos.
          const imp = await createBankStatementImport({
            familyId,
            bankAccountId: accountId,
            memberId: conta?.member_id ?? null,
            nomeArquivo: f.nomeArquivo,
            formato: "PDF",
            parser: f.parsed!.parser,
            createdBy: user?.id ?? null,
            fingerprint: f.fingerprint,
            resumo: { ...f.parsed!, checkpoints: checkpoints[f.id] ?? [] },
            linhas,
          });
          const r = await confirmBankStatementImport(imp.id);
          rel.statements += 1;
          rel.novos += r.criadas;
          rel.existentes += r.associadas;
          rel.duplicidades += (duplicados[f.id] ?? []).filter(Boolean).length;
          rel.checkpoints += (checkpoints[f.id] ?? []).length;
        } catch (e) {
          rel.erros += 1;
          toast.error(
            `${f.nomeArquivo}: ${e instanceof Error ? e.message : "não foi possível salvar"}`,
          );
        }
      }
      return rel;
    },
    onSuccess: (rel) => {
      setRelatorio(rel);
      clearStatementBatchDraft();
      setDraft(null);
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", familyId] });
      queryClient.invalidateQueries({ queryKey: ["transactions", familyId] });
      queryClient.invalidateQueries({ queryKey: ["purchases", familyId] });
      queryClient.invalidateQueries({ queryKey: ["card-invoices", familyId] });
      queryClient.invalidateQueries({ queryKey: ["bank-statement-imports", accountId] });
      queryClient.invalidateQueries({ queryKey: ["bank-statement-items", accountId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removerArquivo = (id: string) => {
    if (!draft) return;
    const novo = { ...draft, arquivos: draft.arquivos.filter((f) => f.id !== id) };
    saveStatementBatchDraft(novo);
    setDraft(novo);
  };

  const verDiagnostico = (f: BatchFile) => {
    if (!f.parsed) return;
    saveStatementDraft({
      accountId,
      nomeArquivo: f.nomeArquivo,
      formato: "PDF",
      fingerprint: f.fingerprint,
      jaImportado: f.jaImportado,
      resumo: f.parsed,
    });
    navigate({ to: "/dev/bank-parser-diagnostics", search: { import: "draft" } });
  };

  const voltar = () => navigate({ to: "/bancos/$accountId", params: { accountId } });

  if (!family) return <NoFamily />;

  if (relatorio) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <Card>
          <h1 className="text-xl font-extrabold">Lote concluído</h1>
          <dl className="mt-4 grid gap-3 sm:grid-cols-2">
            <Item label="Arquivos processados" valor={relatorio.arquivos} />
            <Item label="Statements criados" valor={relatorio.statements} />
            <Item label="Movimentos novos" valor={relatorio.novos} />
            <Item label="Movimentos já existentes" valor={relatorio.existentes} />
            <Item label="Duplicidades evitadas" valor={relatorio.duplicidades} />
            <Item label="Checkpoints criados" valor={relatorio.checkpoints} />
            <Item label="Arquivos com erro" valor={relatorio.erros} />
          </dl>
          <PrimaryButton type="button" className="mt-6" onClick={voltar}>
            Ver a conta
          </PrimaryButton>
        </Card>
      </div>
    );
  }

  if (!draft || !arquivos.length) {
    return (
      <div className="mx-auto w-full max-w-3xl px-4 py-8">
        <EmptyState
          title="Nenhum lote em revisão"
          description="Volte para a conta e selecione vários PDFs de extrato de uma só vez."
          action={
            <PrimaryButton type="button" onClick={voltar}>
              Voltar para a conta
            </PrimaryButton>
          }
        />
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-[1200px] px-4 pb-32 pt-6">
      <DetailHeader
        backTo="/bancos"
        backLabel="Bancos"
        title="Revisar importação"
        subtitle={`${conta?.banco ?? "Conta bancária"}${
          conta?.nome_conta ? ` · ${conta.nome_conta}` : ""
        } · ${arquivos.length} arquivo(s)`}
      />

      <Card>
        <h2 className="text-base font-bold">Resumo do lote</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {mesResumo(resumo.periodoInicio, resumo.periodoFim)}
        </p>
        <dl className="mt-4 grid gap-3 sm:grid-cols-3">
          <Item label="Arquivos" valor={resumo.arquivos} />
          <Item label="Movimentos encontrados" valor={resumo.movimentos} />
          <Item label="Movimentos novos" valor={resumo.novos} />
          <Item label="Possíveis duplicidades" valor={resumo.duplicados} />
          <Item label="Checkpoints" valor={resumo.checkpoints} />
          <Item label="Arquivos com erro" valor={resumo.comErro} />
        </dl>

        {sobreposicoes.length > 0 && (
          <div className="mt-4 rounded-2xl bg-amber-500/10 p-3 text-xs font-semibold text-amber-700 dark:text-amber-400">
            {sobreposicoes.map((s) => {
              const a = arquivos.find((f) => f.id === s.aId)?.nomeArquivo ?? s.aId;
              const b = arquivos.find((f) => f.id === s.bId)?.nomeArquivo ?? s.bId;
              return (
                <p key={`${s.aId}-${s.bId}`}>
                  Períodos sobrepostos entre {a} e {b}: {formatDate(s.inicio)} →{" "}
                  {formatDate(s.fim)} — não é erro, apenas não duplicamos os lançamentos.
                </p>
              );
            })}
          </div>
        )}
      </Card>

      <div className="mt-6 space-y-3">
        {arquivos.map((f) => {
          const dup = (duplicados[f.id] ?? []).filter(Boolean).length;
          const movimentos = f.parsed?.movimentos ?? [];
          const expandido = aberto === f.id;
          return (
            <Card key={f.id} className="p-0">
              <div className="flex flex-wrap items-center gap-3 px-4 py-3 sm:px-5">
                <div className="min-w-0 flex-1">
                  <p className="truncate font-bold">{f.nomeArquivo}</p>
                  <p className="mt-0.5 text-xs text-muted-foreground">
                    {f.status === "OK"
                      ? `${mesResumo(f.parsed?.periodoInicio ?? null, f.parsed?.periodoFim ?? null)} · ${
                          movimentos.length
                        } movimento(s) · ${(f.parsed?.checkpoints ?? []).length} checkpoint(s)${
                          dup ? ` · ${dup} duplicado(s)` : ""
                        }`
                      : (f.erro ?? "Não foi possível ler este arquivo.")}
                  </p>
                </div>

                <span
                  className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-bold ${
                    f.status === "OK"
                      ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400"
                      : "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  }`}
                >
                  {f.status === "OK" ? (
                    <Check className="size-3.5" />
                  ) : (
                    <TriangleAlert className="size-3.5" />
                  )}
                  {f.status === "OK" ? "Parser validado" : "Com problema"}
                </span>

                {f.status === "OK" && (
                  <button
                    type="button"
                    onClick={() => setAberto(expandido ? null : f.id)}
                    className="inline-flex items-center gap-1 text-xs font-semibold text-primary"
                  >
                    Ver movimentos
                    <ChevronDown className={`size-3.5 ${expandido ? "rotate-180" : ""}`} />
                  </button>
                )}
                {f.status === "OK" && (
                  <button
                    type="button"
                    onClick={() => verDiagnostico(f)}
                    className="text-xs font-semibold text-primary underline-offset-2 hover:underline"
                  >
                    Ver diagnóstico
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => removerArquivo(f.id)}
                  className="text-xs font-semibold text-muted-foreground hover:text-destructive"
                >
                  Remover
                </button>
              </div>

              {expandido && (
                <div className="max-h-[50vh] overflow-auto border-t border-border">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="sticky top-0 bg-card">
                      <tr className="text-[11px] uppercase tracking-wide text-muted-foreground">
                        <th className="px-4 py-2">Data</th>
                        <th className="px-4 py-2">Descrição</th>
                        <th className="px-4 py-2">Situação</th>
                        <th className="px-4 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-border">
                      {movimentos.map((m, i) => (
                        <tr key={`${f.id}-${i}`} className={duplicados[f.id]?.[i] ? "opacity-60" : ""}>
                          <td className="px-4 py-2 tabular-nums">
                            {m.data ? formatDate(m.data) : "—"}
                          </td>
                          <td className="px-4 py-2">{m.descricaoOriginal}</td>
                          <td className="px-4 py-2 text-xs text-muted-foreground">
                            {duplicados[f.id]?.[i] ? "Já presente no lote/conta" : "Novo"}
                          </td>
                          <td className="px-4 py-2 text-right font-semibold tabular-nums">
                            {formatCurrency(m.valor)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </Card>
          );
        })}
      </div>

      <div className="fixed inset-x-0 bottom-0 border-t border-border bg-card/95 px-4 py-3 backdrop-blur">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            {validos.length} arquivo(s) pronto(s)
            {comErro.length ? ` · ${comErro.length} com erro` : ""} ·{" "}
            {resumo.novos} movimento(s) novo(s)
          </p>
          <div className="flex items-center gap-3">
            <Link
              to="/bancos/$accountId"
              params={{ accountId }}
              className="text-xs font-semibold text-muted-foreground hover:text-foreground"
            >
              Cancelar
            </Link>
            <PrimaryButton
              type="button"
              disabled={!validos.length || confirmar.isPending}
              onClick={() => confirmar.mutate()}
            >
              {confirmar.isPending
                ? "Salvando…"
                : `Confirmar ${validos.length} arquivo(s) válido(s)`}
            </PrimaryButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function Item({ label, valor }: { label: string; valor: number }) {
  return (
    <div className="rounded-2xl bg-muted/60 p-3">
      <dt className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
        {label}
      </dt>
      <dd className="mt-1 text-lg font-extrabold tabular-nums">{valor}</dd>
    </div>
  );
}
