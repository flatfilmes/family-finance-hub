import { describe, expect, it } from "vitest";
import {
  linhasOficiaisDaFatura,
  resumoOficialDaFatura,
  type LancamentoOficial,
} from "@/lib/card-details";

const item = (p: Partial<LancamentoOficial> & { id: string; valor: number }): LancamentoOficial => ({
  data_lancamento: "2026-08-01",
  descricao_original: p.id,
  estabelecimento_sugerido: null,
  tipo_sugerido: "COMPRA",
  tipo_revisado: null,
  parcela_atual: null,
  total_parcelas: null,
  categoria_sugerida_id: null,
  purchase_id_criada: null,
  purchase_id_matched: null,
  recurring_expense_id_matched: null,
  ...p,
});

describe("fatura oficial: reclassificação de tipo", () => {
  const items: LancamentoOficial[] = [
    item({ id: "normal", valor: 100 }),
    item({ id: "youtube", valor: 53.9, tipo_revisado: "RECORRENTE" }),
    item({ id: "parcela", valor: 200, parcela_atual: 2, total_parcelas: 6 }),
    item({ id: "iof", valor: 4.94, tipo_sugerido: "TAXA" }),
    item({ id: "estorno", valor: -0.05, tipo_sugerido: "ESTORNO" }),
  ];

  it("move o valor de normais para recorrentes sem mudar o total", () => {
    const resumo = resumoOficialDaFatura(linhasOficiaisDaFatura({ items }));
    expect(resumo.recorrentes).toBe(53.9);
    expect(resumo.normais).toBe(100);
    expect(resumo.parceladas).toBe(200);
    expect(resumo.taxas).toBe(4.94);
    expect(resumo.creditos).toBe(-0.05);
    expect(resumo.total).toBe(358.79);

    const semRevisao = resumoOficialDaFatura(
      linhasOficiaisDaFatura({ items: items.map((i) => ({ ...i, tipo_revisado: null })) }),
    );
    expect(semRevisao.total).toBe(resumo.total);
    expect(semRevisao.recorrentes).toBe(0);
    expect(semRevisao.normais).toBe(153.9);
  });

  it("filtro Recorrente lista exatamente o valor do card Recorrências", () => {
    const linhas = linhasOficiaisDaFatura({ items });
    const recorrentes = linhas.filter((l) => l.kind === "recorrentes");
    const soma = recorrentes.reduce((a, l) => a + l.valor, 0);
    expect(recorrentes).toHaveLength(1);
    expect(soma).toBe(resumoOficialDaFatura(linhas).recorrentes);
  });

  it("vínculo com recurring_expense também classifica como recorrente", () => {
    const linhas = linhasOficiaisDaFatura({
      items: [item({ id: "apple", valor: 5.9, recurring_expense_id_matched: "r1" })],
    });
    expect(linhas[0]!.kind).toBe("recorrentes");
  });
});
