/**
 * GOLDEN GEOMÉTRICO — ITAU_PDF espacial.
 *
 * Os TextItems abaixo reproduzem a geometria REAL observada no dump bruto
 * (page width 595.276): BENONI na coluna esquerda em y 638.64 com categoria em
 * 629.64, e 29 GASTROPUB na coluna direita no MESMO y. Se o parser voltar a
 * juntar colunas ou a associar por índice, estes testes quebram.
 */
import { describe, expect, it } from "vitest";
import type { PdfPageLayout, PdfTextItem } from "@/lib/pdf-extract";
import { buildRowsByY, parseCategoriaCidade, parseItauSpatial } from "./itau-spatial";

const it_ = (text: string, x: number, y: number, width = 40): PdfTextItem => ({ text, x, y, width });

const page2: PdfPageLayout = {
  page: 2,
  width: 595.276,
  height: 841.89,
  items: [
    // cabeçalho e contexto do cartão
    it_("RODRIGO NUNES AMADOR (final 8294)", 151.2, 700.0, 180),
    it_("Lançamentos: compras e saques", 151.2, 680.0, 150),
    it_("DATA", 151.2, 660.0, 30),
    it_("ESTABELECIMENTO", 178.2, 660.0, 90),
    it_("VALOR EM R$", 319.29, 660.0, 60),
    // ordem propositalmente "errada" (pdfjs devolve esquerda, depois direita)
    it_("20/05", 151.2, 638.64, 26),
    it_("BENONI AUTO MECANI03/06", 178.2, 638.64, 120),
    it_("410,85", 319.32, 638.64, 30),
    it_("VEÍCULOS .TUBARAO", 178.2, 629.64, 90),
    it_("07/08", 151.2, 610.0, 26),
    it_("D1 ATACADO", 178.2, 610.0, 60),
    it_("01/06", 240.0, 610.0, 26),
    it_("159,65", 319.35, 610.0, 30),
    it_("ALIMENTAÇÃO .TUBARAO", 178.2, 601.0, 100),
    // coluna direita — mesmo Y da BENONI
    it_("12/07", 367.2, 638.64, 26),
    it_("29 GASTROPUB", 394.2, 638.64, 70),
    it_("25,00", 539.16, 638.64, 28),
    it_("ALIMENTAÇÃO .TUBARAO", 394.2, 629.64, 100),
  ],
};

const parsed = parseItauSpatial([page2]);
const acha = (nome: string) => parsed.espaciais.find((e) => e.merchantRaw.includes(nome))!;

describe("ITAU_PDF espacial — geometria real", () => {
  it("separa colunas: BENONI é LEFT e GASTROPUB é RIGHT", () => {
    expect(acha("BENONI").column).toBe("LEFT");
    expect(acha("GASTROPUB").column).toBe("RIGHT");
    // nunca podem viver na mesma transação
    expect(acha("BENONI").merchantRaw).not.toMatch(/GASTROPUB/);
    expect(acha("GASTROPUB").merchantRaw).not.toMatch(/BENONI/);
  });

  it("BENONI: data, parcela colada, valor, categoria e cidade", () => {
    const t = acha("BENONI");
    expect(t.date?.slice(5)).toBe("05-20");
    expect(t.merchant).toBe("BENONI AUTO MECANI");
    expect(t.installmentCurrent).toBe(3);
    expect(t.installmentTotal).toBe(6);
    expect(t.amount).toBeCloseTo(410.85, 2);
    expect(t.category).toBe("VEÍCULOS");
    expect(t.city).toBe("TUBARAO");
  });

  it("GASTROPUB: lançamento independente da coluna esquerda", () => {
    const t = acha("GASTROPUB");
    expect(t.date?.slice(5)).toBe("07-12");
    expect(t.merchant).toBe("29 GASTROPUB");
    expect(t.amount).toBeCloseTo(25, 2);
    expect(t.category).toBe("ALIMENTAÇÃO");
    expect(t.city).toBe("TUBARAO");
    expect(t.installmentCurrent).toBeNull();
  });

  it("categoria fica exatamente 9 pontos abaixo, na mesma coluna", () => {
    for (const nome of ["BENONI", "GASTROPUB"]) {
      const t = acha(nome);
      expect(t.transactionY).toBeCloseTo(638.64, 2);
      expect(t.categoryY).toBeCloseTo(629.64, 2);
      expect(t.transactionY - (t.categoryY ?? 0)).toBeCloseTo(9, 2);
    }
  });

  it("parcela em TextItem separado é concatenada por X (D1 ATACADO 01/06)", () => {
    const t = acha("D1 ATACADO");
    expect(t.installmentCurrent).toBe(1);
    expect(t.installmentTotal).toBe(6);
    expect(t.amount).toBeCloseTo(159.65, 2);
  });

  it("contexto de cartão vem do bloco (final 8294)", () => {
    expect(new Set(parsed.espaciais.map((e) => e.cardLast4))).toEqual(new Set(["8294"]));
  });

  it("buildRowsByY não junta itens de Y diferentes", () => {
    const linhas = buildRowsByY(page2.items.filter((i) => i.x < 350), 2, "LEFT");
    const linha = linhas.find((l) => Math.abs(l.y - 638.64) < 0.8)!;
    expect(linha.items.map((i) => i.text)).toEqual(["20/05", "BENONI AUTO MECANI03/06", "410,85"]);
  });

  it("parseCategoriaCidade trata categoria sem cidade", () => {
    expect(parseCategoriaCidade("SAÚDE .")).toEqual({ category: "SAÚDE", city: null });
  });
});

/**
 * PÁGINA 4 — seções verticais na esquerda (internacional, serviços, próximas
 * faturas) enquanto a direita traz blocos comerciais (limites, simulação, CET).
 */
const page4: PdfPageLayout = {
  page: 4,
  width: 595.276,
  height: 841.89,
  items: [
    it_("Lançamentos internacionais", 151.2, 700.0, 140),
    it_("01/08", 151.2, 680.0, 26),
    it_("GOOGLE*WORKSPACE FLATF", 178.2, 680.0, 120),
    it_("141,77", 319.3, 680.0, 30),
    it_("MOUNTAIN VIEW", 178.2, 671.0, 80),
    it_("26,40", 260.0, 671.0, 28),
    it_("USD", 290.0, 671.0, 20),
    it_("Dólar de Conversão R$ 5,37", 178.2, 662.0, 110),
    it_("Repasse de IOF em R$", 178.2, 653.0, 100),
    it_("4,94", 319.4, 653.0, 24),
    it_("Total transações inter.", 178.2, 644.0, 100),
    it_("146,71", 319.4, 644.0, 30),
    it_("Lançamentos: produtos e serviços", 151.2, 630.0, 150),
    it_("ANUIDADE DIFERENCI01/12", 178.2, 615.0, 120),
    it_("46,00", 319.4, 615.0, 28),
    it_("Compras parceladas - próximas faturas", 151.2, 600.0, 170),
    it_("02/06", 151.2, 585.0, 26),
    it_("D1 ATACADO 02/06", 178.2, 585.0, 90),
    it_("159,65", 319.4, 585.0, 30),
    // coluna direita: bloco comercial que NÃO pode contaminar a esquerda
    it_("Limites de crédito", 367.2, 700.0, 100),
    it_("Limite total de crédito", 394.2, 685.0, 110),
    it_("56.066,00", 535.4, 685.0, 40),
    it_("Simulação de parcelamento", 367.2, 660.0, 130),
    it_("Valor total financiado", 394.2, 645.0, 110),
    it_("6.577,67", 535.4, 645.0, 40),
    it_("CET 3,49% a.m.", 394.2, 630.0, 80),
  ],
};

describe("ITAU_PDF espacial — seções verticais e blocos comerciais", () => {
  const p4 = parseItauSpatial([page4]);
  const desc = p4.entries.map((e) => e.descricao_original);

  it("internacional: só a compra principal e o IOF viram lançamento", () => {
    expect(desc.some((d) => d.includes("GOOGLE"))).toBe(true);
    expect(p4.entries.find((e) => e.descricao_original.includes("GOOGLE"))!.valor).toBeCloseTo(141.77, 2);
    const iof = p4.entries.find((e) => /IOF/i.test(e.descricao_original));
    expect(iof?.valor).toBeCloseTo(4.94, 2);
    expect(iof?.tipo_sugerido).toBe("TAXA");
  });

  it("detalhes de câmbio e totais nunca viram lançamento", () => {
    expect(desc.some((d) => /USD|MOUNTAIN VIEW|Conversão|Total transa/i.test(d))).toBe(false);
  });

  it("anuidade entra como TAXA com parcela 1/12", () => {
    const anuidade = p4.entries.find((e) => /ANUIDADE/i.test(e.descricao_original))!;
    expect(anuidade.valor).toBeCloseTo(46, 2);
    expect(anuidade.tipo_sugerido).toBe("TAXA");
    expect([anuidade.parcela_atual, anuidade.total_parcelas]).toEqual([1, 12]);
  });

  it("próximas faturas ficam fora da fatura atual", () => {
    expect(desc.some((d) => d.includes("D1 ATACADO"))).toBe(false);
    expect(p4.futuras.some((f) => f.descricao_original.includes("D1 ATACADO"))).toBe(true);
  });

  it("limites, CET e simulação da direita não viram lançamento", () => {
    expect(desc.some((d) => /Limite|CET|financiado/i.test(d))).toBe(false);
    expect(p4.entries.some((e) => e.valor === 56066 || e.valor === 6577.67)).toBe(false);
  });
});
