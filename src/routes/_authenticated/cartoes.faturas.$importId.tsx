import { useMemo, useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { CheckCircle2, Loader2, Receipt } from "lucide-react";
import { Card, Field, PrimaryButton, inputClass } from "@/components/page-header";
import { DetailHeader, Metric, SectionTitle } from "@/components/detail-page";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/empty-state";
import { NoFamily } from "@/components/no-family";
import { useFamily } from "@/hooks/useFamilyData";
import { useCreditCards } from "@/hooks/useFinanceData";
import { usePurchases } from "@/hooks/usePurchases";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { usePermissions } from "@/hooks/usePermissions";
import {
  useConfirmStatementImport,
  useStatementImport,
  useStatementItems,
  useStatementItemActions,
} from "@/hooks/useCardStatements";
import {
  ACTION_BADGES,
  ACTION_HELP,
  ACTION_TONES,
  KIND_LABELS,
  IMPORT_STATUS_LABELS,
  formatOptional,
  needsAttention,
  resolveReviewAction,
  reviewSummary,
  userChoice,
  type ReviewAction,
  type StatementItem,
} from "@/lib/card-statements";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";
import { useRecurringExpenses } from "@/hooks/useRecurringExpenses";

export const Route = createFileRoute("/_authenticated/cartoes/faturas/$importId")({
  head: () => ({
    meta: [
      { title: "Revisar fatura importada — Família Finance AI" },
      {
        name: "description",
        content:
          "Confira os lançamentos da fatura do cartão, concilie com as compras já cadastradas e crie apenas o que faltar.",
      },
      { property: "og:title", content: "Revisar fatura importada — Família Finance AI" },
      {
        property: "og:description",
        content: "Conciliação da fatura em PDF com as compras, parcelas e recorrências da família.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: RevisarFaturaPage,
});

type Filtro = "" | "ATENCAO" | ReviewAction;

const FILTROS: { valor: Filtro; label: string }[] = [
  { valor: "", label: "Todos" },
  { valor: "ATENCAO", label: "Precisa de atenção" },
  { valor: "CREATE_PURCHASE", label: "Novas compras" },
  { valor: "ASSOCIATE_EXISTING", label: "Associados" },
  { valor: "POSSIBLE_MATCH", label: "Possíveis correspondências" },
  { valor: "REGISTER_FEE", label: "Taxas" },
  { valor: "REGISTER_CREDIT", label: "Créditos e estornos" },
  { valor: "IGNORE", label: "Ignorados" },
];

function RevisarFaturaPage() {
  const { importId } = Route.useParams();
  const { data: family } = useFamily();
  const { data: importacao, isLoading } = useStatementImport(importId);
  const { data: items } = useStatementItems(importId);
  const { data: cards } = useCreditCards(family?.id);
  const { data: purchases } = usePurchases(family?.id);
  const { data: categorias } = useExpenseCategories();
  const perms = usePermissions();
  const recorrencias = useRecurringExpenses(family?.id);
  const acoes = useStatementItemActions(importId);
  const confirmar = useConfirmStatementImport(family?.id);

  const [filtro, setFiltro] = useState<Filtro>("");
  const [filtroCartao, setFiltroCartao] = useState<string>("");

  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [resultado, setResultado] = useState<string>("");
  const [erro, setErro] = useState("");

  const lista = useMemo(() => items ?? [], [items]);
  const cartao = (cards ?? []).find((c) => c.id === importacao?.credit_card_id) ?? null;

  if (!family) return <NoFamily />;
  if (isLoading) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Carregando a fatura…
      </div>
    );
  }
  if (!importacao) {
    return (
      <div>
        <DetailHeader backTo="/cartoes" backLabel="Voltar para Cartões" title="Fatura não encontrada" />
        <Card>
          <p className="text-sm text-muted-foreground">
            Esta importação não existe ou não está disponível para o seu perfil.
          </p>
        </Card>
      </div>
    );
  }

  const resumo = reviewSummary(lista);
  const atuais = lista.filter((i) => i.tipo_sugerido !== "PAGAMENTO");
  const totalExtraido = atuais.reduce((acc, i) => acc + (Number(i.valor) || 0), 0);
  const soma = (filtrar: (i: StatementItem) => boolean) =>
    atuais.filter(filtrar).reduce((acc, i) => acc + (Number(i.valor) || 0), 0);
  const compras = soma((i) => i.tipo_sugerido === "COMPRA" && Number(i.valor) > 0);
  const creditos = soma((i) => Number(i.valor) < 0 || i.tipo_sugerido === "ESTORNO");
  const taxas = soma(
    (i) =>
      Number(i.valor) > 0 &&
      (i.tipo_sugerido === "TAXA" || i.tipo_sugerido === "JUROS" || i.tipo_sugerido === "AJUSTE"),
  );
  const valorFatura = Number(importacao.valor_total_fatura) || 0;
  const diferenca = valorFatura - totalExtraido;
  const bateu = Math.abs(diferenca) < 0.01 && valorFatura > 0;
  // Segurança: soma muito acima da fatura indica leitura de limites/simulações.
  const foraDeControle =
    valorFatura > 0 &&
    (Math.abs(diferenca) > Math.max(valorFatura * 0.15, 50) || totalExtraido > valorFatura * 3);

  const brutos = (importacao.dados_brutos_json ?? {}) as {
    metadata?: Record<string, number | string | null> | null;
    subtotais?: { card_last4: string; valor: number }[];
    futuras?: { descricao_original: string }[];
  };
  const proximaFatura = Number(brutos.metadata?.["next_invoice_amount"] ?? 0) || 0;
  const demaisFaturas = Number(brutos.metadata?.["future_invoices_amount"] ?? 0) || 0;
  const futuroComprometido = Number(brutos.metadata?.["future_commitments_total"] ?? 0) || 0;
  const finais = Array.from(
    new Set(lista.map((i) => i.card_last4).filter(Boolean) as string[]),
  ).sort();

  const filtradas = lista.filter(
    (i) =>
      (filtro === ""
        ? true
        : filtro === "ATENCAO"
          ? needsAttention(i)
          : resolveReviewAction(i) === filtro) &&
      (filtroCartao ? i.card_last4 === filtroCartao : true),
  );


  const comprasDoCartao = (purchases ?? []).filter(
    (p) => p.credit_card_id === importacao.credit_card_id,
  );
  const recorrenteNome = (id: string | null) =>
    (recorrencias.data ?? []).find((r) => r.id === id)?.nome ?? "recorrência cadastrada";
  const categoriaNome = (id: string | null) =>
    (categorias ?? []).find((c) => c.id === id)?.nome ?? "Sem categoria";

  const setStatus = (item: StatementItem, patch: Partial<StatementItem>) =>
    acoes.update.mutate({ id: item.id, patch });

  const alternar = (id: string) =>
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((i) => i !== id) : [...atual, id],
    );

  /** Define a ação do lançamento. Ignorar e restaurar são sempre explícitos. */
  const definirAcao = (item: StatementItem, acao: ReviewAction | null) => {
    if (acao === null) {
      setStatus(item, {
        decisao: null,
        ...(item.match_status === "IGNORED" ? { match_status: "UNMATCHED" as const } : {}),
      });
      return;
    }
    setStatus(item, { decisao: acao });
  };

  const selecionarTodos = () =>
    setSelecionados(
      selecionados.length === filtradas.length ? [] : filtradas.map((i) => i.id),
    );

  const aplicarEmLote = (acao: ReviewAction | null) => {
    for (const id of selecionados) {
      const item = lista.find((i) => i.id === id);
      if (item) definirAcao(item, acao);
    }
    setSelecionados([]);
  };

  async function confirmarRevisao() {
    if (!cartao || !importacao) {
      setErro("Cartão da importação não encontrado.");
      return;
    }
    setErro("");
    setResultado("");
    try {
      const r = await confirmar.mutateAsync({
        importacao,
        items: lista,
        card: cartao,
        memberId: importacao.member_id ?? perms.myMemberId ?? null,
      });
      setResultado(
        `${r.criados} compra(s) criada(s), ${r.conciliados} associada(s), ${r.taxas} taxa(s), ${r.creditos} crédito(s)/estorno(s), ${r.atualizados} atualizada(s), ${r.ignorados} ignorado(s).`,
      );
      if (r.erros.length > 0) {
        setErro(
          `${r.erros.length} lançamento(s) falharam: ${r.erros.map((e) => `${e.item} — ${e.mensagem}`).join(" | ")}`,
        );
      }
    } catch (e) {
      setErro(e instanceof Error ? e.message : "Não foi possível confirmar a revisão.");
    }
  }

  const jaConfirmada = importacao.status === "CONFIRMED";

  return (
    <div>
      <DetailHeader
        backTo="/cartoes"
        backLabel="Voltar para Cartões"
        title="Revisar fatura"
        subtitle={`${cartao ? `${cartao.nome_cartao} · ${cartao.banco}` : "Cartão"} — ${importacao.nome_arquivo}`}
        badges={
          <>
            <StatusBadge tone={jaConfirmada ? "ok" : "info"}>
              {IMPORT_STATUS_LABELS[importacao.status]}
            </StatusBadge>
            <StatusBadge tone="muted">Leitura: {importacao.parser}</StatusBadge>
          </>
        }
      />

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <p className="text-lg font-extrabold">
              {cartao ? `${cartao.nome_cartao} · ${cartao.banco}` : "Cartão da importação"}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Titular: {formatOptional(importacao.titular)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Fatura
            </p>
            <p className="text-2xl font-extrabold">
              {valorFatura > 0 ? formatCurrency(valorFatura) : "Não identificado"}
            </p>
          </div>
        </div>
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          <Metric
            label="Vencimento"
            value={
              importacao.data_vencimento
                ? formatDate(importacao.data_vencimento)
                : "Não identificado"
            }
          />
          <Metric
            label="Fechamento"
            value={
              importacao.data_fechamento
                ? formatDate(importacao.data_fechamento)
                : "Não identificado"
            }
          />
          <Metric
            label="Lançamentos"
            value={String(lista.length)}
            hint={finais.length > 1 ? `${finais.length} finais de cartão usados` : "Cartão único"}
          />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Esta é uma única obrigação financeira. Todos os lançamentos abaixo pertencem a esta
          fatura, mesmo quando feitos por cartões adicionais ou virtuais.
        </p>
      </Card>

      <Card className="mt-4">
        <SectionTitle title="Conferência da fatura" />
        <div className="mt-2 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          <Metric
            label="Total oficial da fatura"
            value={valorFatura > 0 ? formatCurrency(valorFatura) : "Não identificado"}
          />
          <Metric label="Compras e saques válidos" value={formatCurrency(compras)} />
          <Metric label="Créditos e estornos" value={formatCurrency(creditos)} />
          <Metric label="Taxas e serviços" value={formatCurrency(taxas)} />
          <Metric
            label="Total reconhecido"
            value={formatCurrency(totalExtraido)}
            {...(bateu ? { tone: "ok" as const } : {})}
          />
          <Metric
            label="Diferença"
            value={formatCurrency(Math.abs(diferenca))}
            hint={bateu ? "Valores conferidos" : "Revise os lançamentos abaixo"}
          />
        </div>
      </Card>

      <div className="mt-4 grid gap-4 sm:grid-cols-3">
        <Metric
          label="Próxima fatura"
          value={proximaFatura > 0 ? formatCurrency(proximaFatura) : "Não identificado"}
        />
        <Metric
          label="Demais faturas"
          value={demaisFaturas > 0 ? formatCurrency(demaisFaturas) : "Não identificado"}
        />
        <Metric
          label="Total futuro comprometido"
          value={futuroComprometido > 0 ? formatCurrency(futuroComprometido) : "Não identificado"}
          hint="Fora desta fatura"
        />
      </div>

      {foraDeControle && (
        <Card className="mt-4 border-destructive/40">
          <p className="text-sm font-bold text-destructive">
            Não conseguimos fechar esta fatura automaticamente.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            A soma dos lançamentos lidos ({formatCurrency(totalExtraido)}) está distante do total da
            fatura ({formatCurrency(valorFatura)}). A criação em lote fica bloqueada até você revisar
            item a item.
          </p>
        </Card>
      )}

      {!bateu && valorFatura > 0 && !foraDeControle && (
        <Card className="mt-4">
          <p className="text-sm font-bold">Diferença de {formatCurrency(Math.abs(diferenca))}</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Possíveis causas: encargos, juros, pagamento anterior, estorno, crédito ou algum item
            que a leitura não reconheceu. Nada é ajustado automaticamente para forçar a igualdade.
          </p>
        </Card>
      )}


      <Card className="mt-4">
        <SectionTitle title="O que vai acontecer ao confirmar" />
        <p className="mt-1 text-sm text-muted-foreground">
          {resumo.total} lançamento(s) encontrados. Tudo entra por padrão — só fica de fora o que
          você marcar como ignorado.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-3 xl:grid-cols-6">
          <Metric label="Novas compras" value={String(resumo.CREATE_PURCHASE)} />
          <Metric label="Associadas" value={String(resumo.ASSOCIATE_EXISTING)} />
          <Metric label="Possíveis correspondências" value={String(resumo.POSSIBLE_MATCH)} />
          <Metric label="Taxas" value={String(resumo.REGISTER_FEE)} />
          <Metric label="Créditos/estornos" value={String(resumo.REGISTER_CREDIT)} />
          <Metric label="Ignorados" value={String(resumo.IGNORE)} />
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          {resumo.atencao > 0
            ? `${resumo.atencao} lançamento(s) precisam de atenção antes de confirmar.`
            : "Nenhum lançamento pendente de decisão."}
          {resumo.POSSIBLE_MATCH > 0 &&
            " Possíveis correspondências sem escolha serão criadas como compras novas."}
        </p>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex flex-wrap items-end gap-3">
            <Field label="Filtrar lançamentos">
              <select
                className={inputClass}
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as Filtro)}
              >
                {FILTROS.map((f) => (
                  <option key={f.valor} value={f.valor}>
                    {f.label}
                  </option>
                ))}
              </select>
            </Field>
            {finais.length > 0 && (
              <Field label="Cartão utilizado (informativo)">
                <select
                  className={inputClass}
                  value={filtroCartao}
                  onChange={(e) => setFiltroCartao(e.target.value)}
                >
                  <option value="">Todos os cartões</option>
                  {finais.map((final) => (
                    <option key={final} value={final}>
                      •••• {final}
                    </option>
                  ))}
                </select>
              </Field>
            )}
          </div>
          {!jaConfirmada && (
            <div className="flex flex-wrap items-center gap-2">
              <AcaoBotao onClick={selecionarTodos}>
                {selecionados.length === filtradas.length && filtradas.length > 0
                  ? "Limpar seleção"
                  : "Selecionar todos"}
              </AcaoBotao>
              {selecionados.length > 0 && (
                <>
                  <AcaoBotao onClick={() => aplicarEmLote("IGNORE")}>
                    Ignorar selecionados ({selecionados.length})
                  </AcaoBotao>
                  <AcaoBotao onClick={() => aplicarEmLote(null)}>
                    Restaurar selecionados
                  </AcaoBotao>
                </>
              )}
            </div>
          )}
        </div>

        {filtroCartao && (
          <p className="mt-2 text-xs text-muted-foreground">
            Filtro apenas investigativo. A obrigação financeira continua sendo uma única fatura de{" "}
            {valorFatura > 0 ? formatCurrency(valorFatura) : "valor não identificado"}.
          </p>
        )}

        <SectionTitle title="Lançamentos da fatura" />


        {filtradas.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-5" />}
            title="Nenhum lançamento neste filtro"
            description="Troque o filtro para ver os demais lançamentos lidos da fatura."
          />
        ) : (
          <ul className="mt-2 divide-y divide-border">
            {filtradas.map((item) => {
              const compraVinculada = comprasDoCartao.find((p) => p.id === item.purchase_id_matched);
              return (
                <li key={item.id} className="py-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex flex-wrap items-center gap-2">
                        {item.match_status === "UNMATCHED" && !jaConfirmada && (
                          <input
                            type="checkbox"
                            checked={selecionados.includes(item.id)}
                            onChange={() => alternar(item.id)}
                            aria-label={`Selecionar ${item.descricao_original}`}
                          />
                        )}
                        <p className="truncate text-sm font-bold">{item.descricao_original}</p>
                        <StatusBadge tone={REVIEW_CLASS_TONES[classifyReviewItem(item)]}>
                          {REVIEW_CLASS_LABELS[classifyReviewItem(item)]}
                        </StatusBadge>
                        <StatusBadge tone={MATCH_TONES[item.match_status]}>
                          {MATCH_LABELS[item.match_status]}
                        </StatusBadge>
                        {item.tipo_sugerido !== "COMPRA" && (
                          <StatusBadge tone="muted">{KIND_LABELS[item.tipo_sugerido]}</StatusBadge>
                        )}
                        {item.card_last4 && (
                          <span className="text-xs text-muted-foreground">
                            •••• {item.card_last4}
                          </span>
                        )}


                        {item.parcela_atual && item.total_parcelas && (
                          <StatusBadge tone="info">
                            {item.parcela_atual}/{item.total_parcelas}
                          </StatusBadge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-muted-foreground">
                        {item.data_lancamento ? formatDate(item.data_lancamento) : "Data não identificada"}
                        {" · "}
                        {formatOptional(item.estabelecimento_sugerido)}
                        {" · Categoria sugerida: "}
                        {categoriaNome(item.categoria_sugerida_id)}
                      </p>
                      {compraVinculada && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Correspondência: {compraVinculada.estabelecimento} ·{" "}
                          {formatCurrency(Number(compraVinculada.valor_total))} ·{" "}
                          {formatDate(compraVinculada.data_compra)}
                        </p>
                      )}
                      {item.recurring_expense_id_matched && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Recorrência já cadastrada:{" "}
                          {recorrenteNome(item.recurring_expense_id_matched)} — será apenas
                          associada, sem criar compra nova.
                        </p>
                      )}
                      {item.installment_id_matched && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Continuação de parcelamento reconhecida
                          {item.parcela_atual && item.total_parcelas
                            ? ` (${item.parcela_atual}/${item.total_parcelas})`
                            : ""}
                          : o parcelamento existente será mantido.
                        </p>
                      )}
                      {item.match_status === "DIVERGENT" && (
                        <p className="mt-1 text-xs font-semibold text-destructive">
                          Valor cadastrado:{" "}
                          {compraVinculada
                            ? formatCurrency(Number(compraVinculada.valor_total))
                            : "—"}{" "}
                          · Valor na fatura: {formatCurrency(Math.abs(Number(item.valor)))} ·
                          Diferença: {formatCurrency(Math.abs(Number(item.diferenca) || 0))}
                        </p>
                      )}
                      {item.match_status === "UNMATCHED" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Este lançamento ainda não existe no sistema.
                        </p>
                      )}
                      {item.match_status === "POSSIBLE_MATCH" && (
                        <p className="mt-1 text-xs text-muted-foreground">
                          Encontramos uma possível correspondência.
                        </p>
                      )}

                      {item.user_action === "ERRO" && (
                        <p className="mt-1 text-xs font-semibold text-destructive">
                          {item.erro_mensagem}
                        </p>
                      )}
                    </div>
                    <div className="text-right">
                      <p className="text-sm font-extrabold">
                        {formatCurrency(Number(item.valor) || 0)}
                      </p>
                      <p className="text-xs text-muted-foreground">
                        {item.user_action === "CONCLUIDO" ? "Concluído" : "Pendente"}
                      </p>
                    </div>
                  </div>

                  {!jaConfirmada && item.user_action !== "CONCLUIDO" && (
                    <div className="mt-2 flex flex-wrap items-center gap-2">
                      {(item.match_status === "POSSIBLE_MATCH" ||
                        item.match_status === "MATCHED") && (
                        <AcaoBotao
                          onClick={() => setStatus(item, { match_status: "MATCHED" })}
                          ativo={item.match_status === "MATCHED"}
                        >
                          Confirmar correspondência
                        </AcaoBotao>
                      )}
                      {item.match_status !== "IGNORED" && (
                        <AcaoBotao onClick={() => setStatus(item, { match_status: "IGNORED" })}>
                          Ignorar
                        </AcaoBotao>
                      )}
                      {item.match_status === "IGNORED" && (
                        <AcaoBotao onClick={() => setStatus(item, { match_status: "UNMATCHED" })}>
                          Reativar
                        </AcaoBotao>
                      )}
                      {item.match_status !== "MATCHED" && item.tipo_sugerido === "COMPRA" && (
                        <AcaoBotao
                          onClick={() =>
                            setStatus(item, {
                              match_status: "CONFIRMED_NEW",
                              decisao: item.match_status === "DIVERGENT" ? "CRIAR_NOVO" : null,
                            })
                          }
                          ativo={item.match_status === "CONFIRMED_NEW"}
                        >
                          Criar compra
                        </AcaoBotao>
                      )}
                      {item.match_status === "DIVERGENT" && (
                        <>
                          <AcaoBotao
                            onClick={() => setStatus(item, { decisao: "USAR_VALOR_FATURA" })}
                            ativo={item.decisao === "USAR_VALOR_FATURA"}
                          >
                            Usar valor da fatura
                          </AcaoBotao>
                          <AcaoBotao
                            onClick={() => setStatus(item, { decisao: "MANTER_VALOR" })}
                            ativo={item.decisao === "MANTER_VALOR"}
                          >
                            Manter valor cadastrado
                          </AcaoBotao>
                        </>
                      )}
                      {item.match_status !== "MATCHED" && (
                        <select
                          className="rounded-full border border-input bg-background px-3 py-1.5 text-xs"
                          value={item.purchase_id_matched ?? ""}
                          onChange={(e) =>
                            setStatus(item, {
                              purchase_id_matched: e.target.value || null,
                              match_status: e.target.value ? "MATCHED" : "UNMATCHED",
                            })
                          }
                        >
                          <option value="">Associar manualmente…</option>
                          {comprasDoCartao.map((p) => (
                            <option key={p.id} value={p.id}>
                              {formatDate(p.data_compra)} · {p.estabelecimento} ·{" "}
                              {formatCurrency(Number(p.valor_total))}
                            </option>
                          ))}
                        </select>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {resultado && (
        <p className="mt-4 rounded-2xl bg-emerald-500/15 p-3 text-sm font-semibold text-emerald-700 dark:text-emerald-400">
          <CheckCircle2 className="mr-1 inline size-4" /> {resultado}
        </p>
      )}
      {erro && (
        <p className="mt-3 rounded-2xl bg-destructive/10 p-3 text-sm font-semibold text-destructive">
          {erro}
        </p>
      )}

      <div className="mt-4 flex justify-end">
        <PrimaryButton
          type="button"
          onClick={confirmarRevisao}
          disabled={confirmar.isPending || jaConfirmada || lista.length === 0}
        >
          {jaConfirmada
            ? "Revisão já confirmada"
            : confirmar.isPending
              ? "Aplicando decisões…"
              : "Confirmar revisão"}
        </PrimaryButton>
      </div>
    </div>
  );
}

function AcaoBotao({
  children,
  onClick,
  ativo = false,
}: {
  children: React.ReactNode;
  onClick: () => void;
  ativo?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`rounded-full border px-3 py-1.5 text-xs font-semibold transition ${
        ativo
          ? "border-primary bg-primary text-primary-foreground"
          : "border-border hover:bg-accent"
      }`}
    >
      {children}
    </button>
  );
}
