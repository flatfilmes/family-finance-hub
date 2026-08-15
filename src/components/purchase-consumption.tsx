import { Card } from "@/components/page-header";
import { useExpenseCategories } from "@/hooks/useExpenses";
import { useConsumptionItems } from "@/hooks/usePurchases";
import { formatCurrency } from "@/lib/finance";

type Agrupado = { chave: string; nome: string; total: number; vezes: number };

function ranking(rows: Agrupado[]) {
  return rows.sort((a, b) => b.total - a.total).slice(0, 5);
}

/**
 * Visão de consumo das compras filtradas: produtos mais comprados e categorias
 * mais consumidas. Agregação simples — sem inteligência ou previsões ainda.
 */
export function VisaoConsumo({ purchaseIds }: { purchaseIds: string[] }) {
  const { data: items } = useConsumptionItems(purchaseIds);
  const { data: categorias } = useExpenseCategories();

  const lista = items ?? [];

  const porProduto = new Map<string, Agrupado>();
  const porCategoria = new Map<string, Agrupado>();

  for (const item of lista) {
    const nomeProduto = item.descricao_produto.trim();
    const chaveProduto = nomeProduto.toLowerCase();
    const produto = porProduto.get(chaveProduto) ?? {
      chave: chaveProduto,
      nome: nomeProduto,
      total: 0,
      vezes: 0,
    };
    produto.total += Number(item.valor_total) || 0;
    produto.vezes += 1;
    porProduto.set(chaveProduto, produto);

    const chaveCategoria = item.categoria_id ?? "sem-categoria";
    const nomeCategoria =
      (categorias ?? []).find((c) => c.id === item.categoria_id)?.nome ?? "Sem categoria";
    const categoria = porCategoria.get(chaveCategoria) ?? {
      chave: chaveCategoria,
      nome: nomeCategoria,
      total: 0,
      vezes: 0,
    };
    categoria.total += Number(item.valor_total) || 0;
    categoria.vezes += 1;
    porCategoria.set(chaveCategoria, categoria);
  }

  const produtos = ranking([...porProduto.values()]);
  const categoriasRank = ranking([...porCategoria.values()]);

  return (
    <Card className="mt-4">
      <h2 className="text-base font-bold">Visão de consumo</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Baseada nos produtos das compras filtradas. Análises de hábitos e previsões chegam nas
        próximas fases.
      </p>
      {lista.length === 0 ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Ainda não há produtos detalhados nas compras filtradas.
        </p>
      ) : (
        <div className="mt-4 grid gap-6 lg:grid-cols-2">
          <div>
            <h3 className="text-sm font-bold">Produtos mais comprados</h3>
            <ul className="mt-2 divide-y divide-border">
              {produtos.map((p) => (
                <li key={p.chave} className="flex items-center justify-between py-2 text-sm">
                  <span>
                    {p.nome}{" "}
                    <span className="text-xs text-muted-foreground">
                      · {p.vezes} {p.vezes === 1 ? "vez" : "vezes"}
                    </span>
                  </span>
                  <span className="font-semibold">{formatCurrency(p.total)}</span>
                </li>
              ))}
            </ul>
          </div>
          <div>
            <h3 className="text-sm font-bold">Categorias mais consumidas</h3>
            <ul className="mt-2 divide-y divide-border">
              {categoriasRank.map((c) => (
                <li key={c.chave} className="flex items-center justify-between py-2 text-sm">
                  <span>{c.nome}</span>
                  <span className="font-semibold">{formatCurrency(c.total)}</span>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </Card>
  );
}
