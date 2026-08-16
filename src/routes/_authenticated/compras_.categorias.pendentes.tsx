import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { toast } from "sonner";
import { CheckCircle2, Sparkles, Tags } from "lucide-react";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { SearchInput, matchesSearch } from "@/components/search-input";
import { EmptyState } from "@/components/empty-state";
import { StatusBadge } from "@/components/status-badge";
import { useFamily } from "@/hooks/useFamilyData";
import { usePermissions } from "@/hooks/usePermissions";
import { useExpenseCategories } from "@/hooks/useExpenses";
import {
  useApplyCategory,
  useCategoryRules,
  useCreateCategoryRule,
  usePendingCategoryItems,
  usePendingCategoryPurchases,
} from "@/hooks/useCategoryReview";
import {
  MATCH_LABELS,
  sugerirCategoria,
  sugerirTermoRegra,
  type CategoryRuleMatch,
  type PendingRow,
} from "@/lib/category-review";
import { formatCurrency } from "@/lib/finance";
import { formatDate } from "@/lib/expenses";

export const Route = createFileRoute("/_authenticated/compras_/categorias/pendentes")({
  head: () => ({
    meta: [
      { title: "Itens sem categoria — Família Finance AI" },
      {
        name: "description",
        content:
          "Classifique rapidamente produtos e compras sem categoria para melhorar seus relatórios e análises de consumo.",
      },
      { property: "og:title", content: "Itens sem categoria — Família Finance AI" },
      {
        property: "og:description",
        content: "Classifique produtos e compras pendentes em uma única tela.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: CategoriasPendentesPage,
});

type Filtro = "todos" | "produtos" | "compras";

function CategoriasPendentesPage() {
  const { data: family } = useFamily();
  const { isViewer, podeLancar } = usePermissions();
  const podeCategorizar = !isViewer && podeLancar;

  const { data: categorias } = useExpenseCategories();
  const { data: rules } = useCategoryRules(family?.id);
  const { data: itens, isLoading: loadingItens } = usePendingCategoryItems(family?.id);
  const { data: compras, isLoading: loadingCompras } = usePendingCategoryPurchases(family?.id);

  const aplicar = useApplyCategory(family?.id);
  const criarRegra = useCreateCategoryRule(family?.id);

  const [filtro, setFiltro] = useState<Filtro>("todos");
  const [busca, setBusca] = useState("");
  const [estabelecimento, setEstabelecimento] = useState("");
  const [de, setDe] = useState("");
  const [ate, setAte] = useState("");
  const [selecionados, setSelecionados] = useState<string[]>([]);
  const [categoriaLote, setCategoriaLote] = useState("");
  const [regra, setRegra] = useState<{ row: PendingRow; categoriaId: string } | null>(null);

  const todos: PendingRow[] = useMemo(
    () => [...(itens ?? []), ...(compras ?? [])],
    [itens, compras],
  );

  const estabelecimentos = useMemo(
    () => Array.from(new Set(todos.map((r) => r.estabelecimento).filter(Boolean))).sort(),
    [todos],
  );

  const lista = useMemo(() => {
    return todos
      .filter((r) => (filtro === "todos" ? true : filtro === "produtos" ? r.kind === "ITEM" : r.kind === "PURCHASE"))
      .filter((r) => (estabelecimento ? r.estabelecimento === estabelecimento : true))
      .filter((r) => (de ? r.data >= de : true))
      .filter((r) => (ate ? r.data <= ate : true))
      .filter((r) => matchesSearch(busca, r.descricao, r.estabelecimento))
      .sort((a, b) => (a.data < b.data ? 1 : -1));
  }, [todos, filtro, estabelecimento, de, ate, busca]);

  const categoriasSimples = useMemo(
    () => (categorias ?? []).map((c) => ({ id: c.id, nome: c.nome })),
    [categorias],
  );
  const nomeCategoria = (id: string) => categoriasSimples.find((c) => c.id === id)?.nome ?? "";

  function alternar(id: string) {
    setSelecionados((atual) =>
      atual.includes(id) ? atual.filter((x) => x !== id) : [...atual, id],
    );
  }

  async function salvar(row: PendingRow, categoriaId: string, perguntarRegra = true) {
    if (!categoriaId || !podeCategorizar) return;
    try {
      await aplicar.mutateAsync(
        row.kind === "ITEM"
          ? { itemIds: [row.id], categoriaId }
          : { purchaseIds: [row.id], categoriaId },
      );
      setSelecionados((atual) => atual.filter((x) => x !== row.id));
      toast.success(`Classificado como ${nomeCategoria(categoriaId)}`);
      if (perguntarRegra) setRegra({ row, categoriaId });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível salvar a categoria");
    }
  }

  async function salvarLote() {
    if (!categoriaLote || selecionados.length === 0) return;
    const alvo = lista.filter((r) => selecionados.includes(r.id));
    try {
      await aplicar.mutateAsync({
        itemIds: alvo.filter((r) => r.kind === "ITEM").map((r) => r.id),
        purchaseIds: alvo.filter((r) => r.kind === "PURCHASE").map((r) => r.id),
        categoriaId: categoriaLote,
      });
      toast.success(`${alvo.length} item(ns) classificados como ${nomeCategoria(categoriaLote)}`);
      setSelecionados([]);
      setCategoriaLote("");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Não foi possível aplicar a categoria");
    }
  }

  const carregando = loadingItens || loadingCompras;

  return (
    <div className="mx-auto max-w-4xl">
      <PageHeader
        title="Itens sem categoria"
        subtitle="Classifique os itens para melhorar seus relatórios e análises."
      />

      {todos.length > 0 && (
        <Card className="mb-6">
          <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Tags className="size-5 text-primary" />
              <h2 className="text-base font-bold">Pendências</h2>
            </div>
            <StatusBadge tone="warn">{todos.length} pendente(s)</StatusBadge>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <SearchInput value={busca} onChange={setBusca} placeholder="Buscar item ou loja..." />
            <Field label="Tipo">
              <select
                className={inputClass}
                value={filtro}
                onChange={(e) => setFiltro(e.target.value as Filtro)}
              >
                <option value="todos">Todos</option>
                <option value="produtos">Produtos</option>
                <option value="compras">Compras</option>
              </select>
            </Field>
            <Field label="Estabelecimento">
              <select
                className={inputClass}
                value={estabelecimento}
                onChange={(e) => setEstabelecimento(e.target.value)}
              >
                <option value="">Todos</option>
                {estabelecimentos.map((e) => (
                  <option key={e} value={e}>
                    {e}
                  </option>
                ))}
              </select>
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="De">
                <input type="date" className={inputClass} value={de} onChange={(e) => setDe(e.target.value)} />
              </Field>
              <Field label="Até">
                <input type="date" className={inputClass} value={ate} onChange={(e) => setAte(e.target.value)} />
              </Field>
            </div>
          </div>

          {podeCategorizar && selecionados.length > 0 && (
            <div className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-border bg-muted/40 p-4">
              <span className="text-sm font-semibold">{selecionados.length} selecionado(s)</span>
              <div className="min-w-52 flex-1">
                <Field label="Categoria">
                  <select
                    className={inputClass}
                    value={categoriaLote}
                    onChange={(e) => setCategoriaLote(e.target.value)}
                  >
                    <option value="">Selecionar</option>
                    {categoriasSimples.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nome}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <PrimaryButton onClick={() => void salvarLote()} disabled={!categoriaLote}>
                Aplicar categoria
              </PrimaryButton>
            </div>
          )}
        </Card>
      )}

      {carregando ? (
        <Card>
          <p className="text-sm text-muted-foreground">Carregando pendências...</p>
        </Card>
      ) : todos.length === 0 ? (
        <Card>
          <EmptyState
            icon={<CheckCircle2 className="size-5" />}
            title="Tudo categorizado"
            description="Seus relatórios agora podem usar essas informações."
          />
          <div className="mt-4 flex justify-center">
            <Link
              to="/dashboard"
              className="rounded-full bg-primary px-6 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
            >
              Voltar ao Dashboard
            </Link>
          </div>
        </Card>
      ) : lista.length === 0 ? (
        <Card>
          <EmptyState
            icon={<Tags className="size-5" />}
            title="Nenhum item com esses filtros"
            description="Ajuste a busca, o período ou o estabelecimento."
          />
        </Card>
      ) : (
        <Card className="space-y-3">
          {lista.map((row) => (
            <Linha
              key={row.id}
              row={row}
              categorias={categoriasSimples}
              sugestao={sugerirCategoria(row, rules ?? [], categoriasSimples)}
              selecionado={selecionados.includes(row.id)}
              onToggle={() => alternar(row.id)}
              podeCategorizar={podeCategorizar}
              onSalvar={(categoriaId) => void salvar(row, categoriaId)}
            />
          ))}
        </Card>
      )}

      {regra && (
        <RegraDialog
          row={regra.row}
          categoriaNome={nomeCategoria(regra.categoriaId)}
          onClose={() => setRegra(null)}
          onConfirm={async (matchType, matchValue) => {
            try {
              await criarRegra.mutateAsync({
                matchType,
                matchValue,
                categoryId: regra.categoriaId,
              });
              toast.success("Regra salva para itens semelhantes");
            } catch (error) {
              toast.error(error instanceof Error ? error.message : "Não foi possível salvar a regra");
            }
            setRegra(null);
          }}
        />
      )}
    </div>
  );
}

function Linha({
  row,
  categorias,
  sugestao,
  selecionado,
  onToggle,
  podeCategorizar,
  onSalvar,
}: {
  row: PendingRow;
  categorias: { id: string; nome: string }[];
  sugestao: { categoriaId: string; origem: "REGRA" | "PALAVRA" } | null;
  selecionado: boolean;
  onToggle: () => void;
  podeCategorizar: boolean;
  onSalvar: (categoriaId: string) => void;
}) {
  const [valor, setValor] = useState(sugestao?.categoriaId ?? "");
  const nomeSugerida = categorias.find((c) => c.id === sugestao?.categoriaId)?.nome ?? "";

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-border bg-card px-4 py-3">
      {podeCategorizar && (
        <input
          type="checkbox"
          checked={selecionado}
          onChange={onToggle}
          aria-label={`Selecionar ${row.descricao}`}
          className="size-4 shrink-0 accent-[hsl(var(--primary))]"
        />
      )}
      <div className="min-w-48 flex-1">
        <p className="text-sm font-semibold">{row.descricao}</p>
        <p className="text-xs text-muted-foreground">
          {row.estabelecimento} · {formatDate(row.data)} · {formatCurrency(row.valor)}
          {row.kind === "PURCHASE" && " · compra sem produtos detalhados"}
        </p>
        {sugestao && (
          <p className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary">
            <Sparkles className="size-3" />
            Categoria sugerida: {nomeSugerida}
            {sugestao.origem === "REGRA" && " (regra salva)"}
          </p>
        )}
      </div>
      <div className="w-48">
        <select
          className={inputClass}
          value={valor}
          disabled={!podeCategorizar}
          aria-label="Categoria"
          onChange={(e) => {
            setValor(e.target.value);
            if (e.target.value) onSalvar(e.target.value);
          }}
        >
          <option value="">Selecionar</option>
          {categorias.map((c) => (
            <option key={c.id} value={c.id}>
              {c.nome}
            </option>
          ))}
        </select>
      </div>
    </div>
  );
}

function RegraDialog({
  row,
  categoriaNome,
  onClose,
  onConfirm,
}: {
  row: PendingRow;
  categoriaNome: string;
  onClose: () => void;
  onConfirm: (matchType: CategoryRuleMatch, matchValue: string) => void;
}) {
  const [matchType, setMatchType] = useState<CategoryRuleMatch>(
    row.kind === "ITEM" ? "PRODUCT_CONTAINS" : "MERCHANT_CONTAINS",
  );
  const [matchValue, setMatchValue] = useState(
    row.kind === "ITEM" ? sugerirTermoRegra(row.descricao) : row.estabelecimento,
  );

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-4 sm:items-center">
      <div className="w-full max-w-md rounded-3xl border border-border bg-card p-6 shadow-card">
        <h3 className="text-base font-bold">Aplicar automaticamente no futuro?</h3>
        <p className="mt-1 text-sm text-muted-foreground">
          Itens semelhantes passam a ser sugeridos como <strong>{categoriaNome}</strong>.
        </p>

        <div className="mt-4 space-y-3">
          <Field label="Quando">
            <select
              className={inputClass}
              value={matchType}
              onChange={(e) => setMatchType(e.target.value as CategoryRuleMatch)}
            >
              {(Object.keys(MATCH_LABELS) as CategoryRuleMatch[]).map((t) => (
                <option key={t} value={t}>
                  {MATCH_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Texto">
            <input
              className={inputClass}
              value={matchValue}
              onChange={(e) => setMatchValue(e.target.value)}
            />
          </Field>
        </div>

        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold"
          >
            Agora não
          </button>
          <PrimaryButton
            onClick={() => onConfirm(matchType, matchValue)}
            disabled={!matchValue.trim()}
          >
            Salvar regra
          </PrimaryButton>
        </div>
      </div>
    </div>
  );
}
