import { describe, expect, it } from "vitest";
import {
  buildCardCycleComposition,
  classificarCiclosDoCartao,
  parcelamentosAtivos,
  proximasObrigacoes,
  recorrenciasDoCiclo,
} from "@/lib/card-details";
import { recurringForecast } from "@/lib/card-recurrences";

const CARD = { id: "card-1", dia_fechamento: 10, dia_vencimento: 17 };
const HOJE = new Date(2026, 7, 16); // 16/08/2026

function invoice(mes: string, valor: number) {
  return {
    id: `inv-${mes}`,
    credit_card_id: CARD.id,
    status: "ABERTA",
    data_inicio_ciclo: null,
    data_fechamento: `2026-${mes}-10`,
    data_vencimento: `2026-${mes}-17`,
    valor_total: valor,
  };
}

function rec(nome: string, valor: number, proxima: string) {
  return {
    id: `rec-${nome}`,
    nome,
    valor,
    periodicidade: "MENSAL",
    proxima_cobranca: proxima,
    data_inicio: proxima,
    data_cancelamento: null,
    ativo: true,
    purchase_id: null,
    credit_card_id: CARD.id,
  } as never;
}

const RECORRENCIAS = [
  rec("Alboom Photographer", 39, "2026-08-25"),
  rec("Google Workspace", 141.77, "2026-09-01"),
  rec("YouTube Premium", 53.9, "2026-09-07"),
  rec("Apple.com/bill", 5.9, "2026-09-14"),
  rec("Alboom CRM", 49, "2026-09-15"),
  rec("Adobe", 55, "2026-09-15"),
];

describe("atribuição de recorrências por ciclo (fechamento dia 10)", () => {
  const setembro = invoice("09", 1565.07);
  const outubro = invoice("10", 826.88);

  it("cobrança antes do fechamento entra no ciclo atual", () => {
    const ocorrencias = recorrenciasDoCiclo({
      card: CARD,
      invoice: setembro,
      recorrencias: RECORRENCIAS,
      parcelas: [],
    });
    const nomes = ocorrencias.map((o) => o.nome);
    expect(nomes).toEqual(["Alboom Photographer", "Google Workspace", "YouTube Premium"]);
    expect(ocorrencias.reduce((a, o) => a + o.valor, 0)).toBeCloseTo(234.67, 2);
  });

  it("cobrança depois do fechamento vai para o ciclo seguinte", () => {
    const ocorrencias = recorrenciasDoCiclo({
      card: CARD,
      invoice: outubro,
      recorrencias: RECORRENCIAS,
      parcelas: [],
    });
    expect(ocorrencias.map((o) => o.nome).sort()).toEqual(
      ["Adobe", "Alboom CRM", "Alboom Photographer", "Apple.com/bill", "Google Workspace", "YouTube Premium"].sort(),
    );
    expect(ocorrencias.reduce((a, o) => a + o.valor, 0)).toBeCloseTo(344.57, 2);
  });

  it("previsão do cadastro aponta a fatura correta", () => {
    expect(recurringForecast(rec("YouTube", 53.9, "2026-09-07") as never, CARD, HOJE)).toEqual({
      data: "2026-09-07",
      competencia: "2026-09",
    });
    expect(recurringForecast(rec("Adobe", 55, "2026-09-15") as never, CARD, HOJE)).toEqual({
      data: "2026-09-15",
      competencia: "2026-10",
    });
  });
});

describe("uma única verdade por ciclo", () => {
  const invoices = [invoice("08", 5070.94), invoice("09", 1565.07), invoice("10", 826.88)];
  const ciclos = classificarCiclosDoCartao({
    invoices,
    imports: [],
    hoje: HOJE,
    card: CARD,
    recorrencias: RECORRENCIAS,
    parcelas: [],
  });
  const de = (mes: string) => ciclos.find((c) => c.competencia === `2026-${mes}`)!;

  it("régua de setembro já inclui as recorrências do ciclo", () => {
    expect(de("09").valor).toBeCloseTo(1565.07 + 234.67, 2);
  });

  it("resumo e compromissos futuros usam o mesmo número", () => {
    const composicao = buildCardCycleComposition({
      ciclo: de("09"),
      linhasInternas: [
        {
          id: "p1",
          itemId: "p1",
          data: "2026-08-20",
          estabelecimento: "Parcelada",
          memberId: null,
          categoriaId: null,
          kind: "parceladas",
          parcela: "2/6",
          valor: 1565.07,
          purchaseId: null,
        },
      ],
    });
    expect(composicao.recurringOccurrences).toBeCloseTo(234.67, 2);
    expect(composicao.installments).toBeCloseTo(1565.07, 2);
    expect(composicao.total).toBeCloseTo(1799.74, 2);

    const futuros = proximasObrigacoes({
      card: CARD,
      parcelas: [
        {
          id: "p1",
          card_invoice_id: "inv-09",
          status: "PENDENTE",
          valor_parcela: 1565.07,
          data_vencimento: "2026-09-17",
          numero_parcela: 2,
          total_parcelas: 6,
          purchase_id: null,
        } as never,
      ],
      faturas: invoices as never,
      recorrencias: RECORRENCIAS,
      hoje: HOJE,
    });
    const setembro = futuros.find((f) => f.key === "2026-09")!;
    expect(setembro.recorrencias).toBeCloseTo(234.67, 2);
    expect(setembro.total).toBeCloseTo(composicao.total, 2);
  });

  it("outubro projeta as seis recorrências do ciclo", () => {
    expect(de("10").valor).toBeCloseTo(826.88 + 344.57, 2);
  });

  it("fatura oficial confirmada não recebe recorrência projetada", () => {
    const comOficial = classificarCiclosDoCartao({
      invoices: [invoice("09", 1565.07)],
      imports: [
        {
          id: "imp",
          credit_card_id: CARD.id,
          status: "CONFIRMED",
          valor_total_fatura: 1900,
          data_vencimento: "2026-09-17",
          data_fechamento: "2026-09-10",
          periodo_fim: null,
          created_at: "2026-09-11T10:00:00Z",
        },
      ],
      hoje: HOJE,
      card: CARD,
      recorrencias: RECORRENCIAS,
      parcelas: [],
    });
    expect(comOficial[0]!.valor).toBe(1900);
    expect(comOficial[0]!.recorrencias).toEqual([]);
  });
});

describe("próxima parcela de um parcelamento", () => {
  const faturas = [
    { ...invoice("06", 0), status: "ABERTA" },
    { ...invoice("07", 0), status: "ABERTA" },
    { ...invoice("08", 0), status: "ABERTA" },
    { ...invoice("09", 0), status: "ABERTA" },
  ] as never[];

  const parcelas = [
    { id: "i3", expense_id: "e1", card_invoice_id: "inv-06", numero_parcela: 3, total_parcelas: 6, valor_parcela: 410.85, data_vencimento: "2026-06-17", status: "PENDENTE", purchase_id: null },
    { id: "i4", expense_id: "e1", card_invoice_id: "inv-07", numero_parcela: 4, total_parcelas: 6, valor_parcela: 410.85, data_vencimento: "2026-07-17", status: "PENDENTE", purchase_id: null },
    { id: "i5", expense_id: "e1", card_invoice_id: "inv-08", numero_parcela: 5, total_parcelas: 6, valor_parcela: 410.85, data_vencimento: "2026-08-17", status: "PENDENTE", purchase_id: null },
    { id: "i6", expense_id: "e1", card_invoice_id: "inv-09", numero_parcela: 6, total_parcelas: 6, valor_parcela: 410.85, data_vencimento: "2026-09-17", status: "PENDENTE", purchase_id: null },
  ] as never[];

  const ativos = parcelamentosAtivos({
    parcelas,
    faturas,
    despesaPorId: new Map(),
    compraPorId: new Map(),
    hoje: HOJE,
  });

  it("nunca aponta uma cobrança no passado quando há parcelas futuras", () => {
    const p = ativos[0]!;
    expect(p.proximaCobranca).toBe("2026-09-17");
    expect(p.proximaParcela).toBe(6);
    expect(p.numeroAtual).toBe(5);
  });
});
