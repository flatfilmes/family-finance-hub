/**
 * Projeção das parcelas já contratadas para os PRÓXIMOS ciclos.
 *
 * Por que existe: `expense_installments` guarda o cronograma criado quando a
 * compra entrou no sistema. Quando uma série antiga é importada no meio do
 * caminho (ex.: a fatura traz "Alipay 09/12"), o cronograma interno pode estar
 * ancorado em datas históricas e as parcelas restantes acabam em ciclos que já
 * passaram — some da próxima fatura.
 *
 * A fatura oficial confirmada é evidência explícita de qual é a parcela atual
 * de cada série ("Compras parceladas — próximas faturas" do PDF). A partir dela
 * projetamos parcela por parcela nos ciclos seguintes.
 *
 * Regras:
 * - só projeta em ciclos SEM fatura oficial (nunca altera fatura fechada);
 * - a projeção substitui a linha interna da MESMA compra no ciclo (nunca soma);
 * - anuidade e outras taxas parceladas continuam sendo obrigação parcelada.
 */
import type { LinhaOficial } from "@/lib/card-details";
import { resolveReviewType } from "@/lib/statement-types";

export type ItemParceladoOficial = {
  id: string;
  descricao_original: string;
  estabelecimento_sugerido: string | null;
  valor: number | string;
  parcela_atual: number | null;
  total_parcelas: number | null;
  tipo_sugerido: string;
  tipo_revisado?: string | null;
  categoria_sugerida_id: string | null;
  purchase_id_criada: string | null;
  purchase_id_matched: string | null;
};

export type ParcelaProjetada = LinhaOficial & {
  numero: number;
  total: number;
  /** Natureza do lançamento: taxa/serviço continua sendo parcela comprometida. */
  natureza: "COMPRA" | "TAXA_SERVICO";
  statementItemId: string;
};

const arredonda = (v: number) => Math.round(v * 100) / 100;

/**
 * Parcelas restantes de cada série da fatura oficial atribuídas ao ciclo pedido.
 *
 * `offset` é a distância em ciclos entre a fatura oficial e o ciclo alvo
 * (1 = próxima fatura).
 */
export function projetarParcelasDoCiclo(input: {
  itens: ItemParceladoOficial[];
  offset: number;
  vencimentoCiclo: string;
}): ParcelaProjetada[] {
  if (input.offset < 1) return [];
  const linhas: ParcelaProjetada[] = [];

  for (const item of input.itens) {
    const total = item.total_parcelas ?? 1;
    const atual = item.parcela_atual ?? 1;
    if (total <= 1) continue;
    const numero = atual + input.offset;
    if (numero > total) continue;

    const revisado = resolveReviewType(item);
    if (revisado === "IGNORAR" || revisado === "CREDITO") continue;
    const ehTaxa = revisado === "TAXA";
    const valor = arredonda(Number(item.valor) || 0);
    if (valor <= 0) continue;

    linhas.push({
      id: `proj:${item.id}:${numero}`,
      itemId: `proj:${item.id}:${numero}`,
      statementItemId: item.id,
      data: input.vencimentoCiclo,
      estabelecimento: item.estabelecimento_sugerido || item.descricao_original,
      memberId: null,
      categoriaId: item.categoria_sugerida_id ?? null,
      // Obrigação parcelada: mesmo a anuidade entra no bucket de parcelamentos.
      kind: "parceladas",
      parcela: `${numero}/${total}`,
      valor,
      purchaseId: item.purchase_id_criada ?? item.purchase_id_matched ?? null,
      numero,
      total,
      natureza: ehTaxa ? "TAXA_SERVICO" : "COMPRA",
    });
  }

  return linhas.sort((a, b) => b.valor - a.valor);
}

/**
 * Junta linhas internas (expense_installments) com a projeção da fatura oficial
 * sem duplicar: quando a mesma compra aparece nas duas fontes, a evidência do
 * PDF vence e a linha interna é descartada.
 */
export function mesclarParcelasProjetadas(
  linhasInternas: LinhaOficial[],
  projetadas: ParcelaProjetada[],
): LinhaOficial[] {
  if (projetadas.length === 0) return linhasInternas;
  const compras = new Set(projetadas.map((p) => p.purchaseId).filter(Boolean) as string[]);
  const restantes = linhasInternas.filter(
    (l) => !(l.kind === "parceladas" && l.purchaseId && compras.has(l.purchaseId)),
  );
  return [...restantes, ...projetadas];
}

/** Soma das parcelas comprometidas de um conjunto de linhas. */
export function somaParcelas(linhas: LinhaOficial[]) {
  return arredonda(
    linhas.filter((l) => l.kind === "parceladas").reduce((acc, l) => acc + l.valor, 0),
  );
}
