import { describe, expect, it } from "vitest";
import {
  mesclarParcelasProjetadas,
  projetarParcelasDoCiclo,
  somaParcelas,
  type ItemParceladoOficial,
} from "@/lib/card-installment-projection";
import type { LinhaOficial } from "@/lib/card-details";

/** Séries parceladas da fatura Itaú de agosto/2026 (96 lançamentos confirmados). */
const serie = (
  descricao: string,
  atual: number,
  total: number,
  valor: number,
  tipo = "COMPRA",
): ItemParceladoOficial => ({
  id: `item-${descricao}`,
  descricao_original: descricao,
  estabelecimento_sugerido: descricao,
  valor,
  parcela_atual: atual,
  total_parcelas: total,
  tipo_sugerido: tipo,
  tipo_revisado: null,
  categoria_sugerida_id: null,
  purchase_id_criada: `purchase-${descricao}`,
  purchase_id_matched: null,
});

const agosto: ItemParceladoOficial[] = [
  serie("DL*Alipay Alipay", 9, 12, 22.72),
  serie("MERCADOLIVRE*MERCA", 9, 12, 56.53),
  serie("ITAUSHOP", 9, 21, 76.8),
  serie("PP *LIVE ROUPA", 9, 10, 51.17),
  serie("LucianaFelisbino", 8, 12, 216.74),
  serie("MERCADOLIVRE*FUSCA", 7, 10, 52.58),
  serie("BENONI AUTO MECANI", 3, 6, 410.85),
  serie("DESPACHANTE TONON", 3, 12, 265.61),
  serie("ACADEMIA AD3 TUBAR", 2, 12, 134.85),
  serie("0001 FARMACIA TRAB", 1, 3, 189.97),
  serie("EVO*Isabela e Cia", 1, 2, 250),
  serie("ANUIDADE DIFERENCI", 1, 12, 46, "TAXA"),
  serie("MLP*Netshoes-NS2CO", 1, 8, 77.34),
  serie("D1 ATACADO", 1, 6, 159.65),
  // Séries encerradas em agosto: não podem projetar nada.
  serie("FARMACIA PANVEL", 2, 2, 96.82),
  serie("LOJAS RENNER FL 93", 3, 3, 143.24),
];

describe("projeção das parcelas da próxima fatura (Itaú)", () => {
  const setembro = projetarParcelasDoCiclo({
    itens: agosto,
    offset: 1,
    vencimentoCiclo: "2026-09-17",
  });

  it("fecha em R$ 2.010,81, o mesmo valor de 'Próxima fatura' do PDF", () => {
    expect(somaParcelas(setembro)).toBe(2010.81);
    expect(setembro).toHaveLength(14);
  });

  it("inclui individualmente cada obrigação futura do PDF", () => {
    const porParcela = new Map(setembro.map((l) => [`${l.estabelecimento}|${l.parcela}`, l.valor]));
    const esperado: [string, number][] = [
      ["DL*Alipay Alipay|10/12", 22.72],
      ["MERCADOLIVRE*MERCA|10/12", 56.53],
      ["ITAUSHOP|10/21", 76.8],
      ["PP *LIVE ROUPA|10/10", 51.17],
      ["LucianaFelisbino|9/12", 216.74],
      ["MERCADOLIVRE*FUSCA|8/10", 52.58],
      ["BENONI AUTO MECANI|4/6", 410.85],
      ["DESPACHANTE TONON|4/12", 265.61],
      ["ACADEMIA AD3 TUBAR|3/12", 134.85],
      ["0001 FARMACIA TRAB|2/3", 189.97],
      ["EVO*Isabela e Cia|2/2", 250],
      ["ANUIDADE DIFERENCI|2/12", 46],
      ["MLP*Netshoes-NS2CO|2/8", 77.34],
      ["D1 ATACADO|2/6", 159.65],
    ];
    for (const [chave, valor] of esperado) expect(porParcela.get(chave)).toBe(valor);
  });

  it("série encerrada não aparece na próxima fatura", () => {
    expect(setembro.some((l) => l.estabelecimento === "FARMACIA PANVEL")).toBe(false);
    expect(setembro.some((l) => l.estabelecimento === "LOJAS RENNER FL 93")).toBe(false);
  });

  it("a anuidade é taxa de serviço mas continua parcela comprometida", () => {
    const anuidade = setembro.find((l) => l.estabelecimento === "ANUIDADE DIFERENCI")!;
    expect(anuidade.natureza).toBe("TAXA_SERVICO");
    expect(anuidade.kind).toBe("parceladas");
  });

  it("a última parcela encerra a série: Live Roupa some em outubro", () => {
    const outubro = projetarParcelasDoCiclo({
      itens: agosto,
      offset: 2,
      vencimentoCiclo: "2026-10-17",
    });
    expect(outubro.some((l) => l.estabelecimento === "PP *LIVE ROUPA")).toBe(false);
    expect(outubro.some((l) => l.parcela === "11/12" && l.estabelecimento === "DL*Alipay Alipay")).toBe(true);
  });

  it("não duplica quando a mesma compra já tem parcela interna no ciclo", () => {
    const internas: LinhaOficial[] = [
      {
        id: "ei-benoni",
        itemId: "ei-benoni",
        data: "2026-09-17",
        estabelecimento: "Benoni Auto Mecani",
        memberId: null,
        categoriaId: null,
        kind: "parceladas",
        parcela: "6/6",
        valor: 410.85,
        purchaseId: "purchase-BENONI AUTO MECANI",
      },
    ];
    const linhas = mesclarParcelasProjetadas(internas, setembro);
    expect(linhas.filter((l) => l.purchaseId === "purchase-BENONI AUTO MECANI")).toHaveLength(1);
    expect(somaParcelas(linhas)).toBe(2010.81);
  });

  it("ciclo com fatura oficial nunca recebe projeção (offset 0)", () => {
    expect(projetarParcelasDoCiclo({ itens: agosto, offset: 0, vencimentoCiclo: "2026-08-17" })).toHaveLength(0);
  });
});
