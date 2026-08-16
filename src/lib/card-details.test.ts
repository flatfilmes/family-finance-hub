import { describe, expect, it } from "vitest";
import { isStatementConfirmed } from "@/lib/card-statements";
import {
  agruparCiclos,
  classificarCiclosDoCartao,
  faturasFechadasEmAberto,
  obrigacaoAbertaDoCartao,
} from "@/lib/card-details";
import { progressoParcelamento } from "@/lib/purchases";

const invoice = {
  id: "invoice-aug",
  status: "ABERTA",
  data_vencimento: "2026-08-17",
  data_fechamento: "2026-08-10",
  valor_total: 5795.41,
};

const confirmedImport = {
  id: "statement-aug",
  credit_card_id: "itau",
  status: "CONFIRMED",
  valor_total_fatura: 6577.67,
  data_vencimento: "2026-08-17",
  data_fechamento: "2026-08-10",
  periodo_fim: null,
  created_at: "2026-08-16T10:12:16Z",
};

describe("fonte oficial da fatura", () => {
  it("usa a importação confirmada aberta e substitui a estimativa do ciclo", () => {
    expect(isStatementConfirmed(confirmedImport)).toBe(true);
    const result = obrigacaoAbertaDoCartao({
      cardId: "itau",
      invoice,
      imports: [confirmedImport],
    });
    expect(result.oficial).toBe(true);
    expect(result.valor).toBe(6577.67);
  });

  it("remove a fatura paga do consolidado, preservando sua fonte oficial", () => {
    const result = obrigacaoAbertaDoCartao({
      cardId: "itau",
      invoice: { ...invoice, status: "PAGA" },
      imports: [confirmedImport],
    });
    expect(result.oficial).toBe(true);
    expect(result.aberta).toBe(false);
    expect(result.valor).toBe(0);
  });
});
describe("faturasFechadasEmAberto", () => {
  const hoje = new Date(2026, 7, 16);
  const imports = [
    {
      id: "imp-1",
      credit_card_id: "card-1",
      status: "CONFIRMED",
      valor_total_fatura: 6577.67,
      data_vencimento: "2026-08-17",
      data_fechamento: "2026-08-10",
      periodo_fim: "2026-08-10",
      created_at: "2026-08-12",
    },
  ];
  const inv = (id: string, fech: string, venc: string, valor: number, status = "ABERTA") => ({
    id,
    credit_card_id: "card-1",
    status,
    data_fechamento: fech,
    data_vencimento: venc,
    valor_total: valor,
  });

  it("mostra só o ciclo real fechado, ignorando estimativas e projeções", () => {
    const r = faturasFechadasEmAberto({
      invoices: [
        inv("i-ago", "2026-08-10", "2026-08-17", 5795.41),
        inv("i-jul", "2026-07-10", "2026-07-17", 1121.91),
        inv("i-jun", "2026-06-10", "2026-06-17", 896.5),
        inv("i-set", "2026-09-10", "2026-09-17", 1570.55),
      ],
      imports,
      hoje,
    });
    expect(r).toHaveLength(1);
    expect(r[0]!.restante).toBe(6577.67);
    expect(r[0]!.oficial).toBe(true);
  });

  it("exclui fatura paga e saldo quitado", () => {
    expect(
      faturasFechadasEmAberto({
        invoices: [inv("i-ago", "2026-08-10", "2026-08-17", 5795.41, "PAGA")],
        imports,
        hoje,
      }),
    ).toHaveLength(0);
    expect(
      faturasFechadasEmAberto({
        invoices: [inv("i-ago", "2026-08-10", "2026-08-17", 5795.41)],
        imports,
        pagamentos: new Map([["i-ago", 6577.67]]),
        hoje,
      }),
    ).toHaveLength(0);
  });
});

describe("classificarCiclosDoCartao", () => {
  const hoje = new Date(2026, 7, 16);
  const ciclo = (mes: string, status = "ABERTA", valor = 100) => ({
    id: `i-${mes}`,
    credit_card_id: "card-1",
    status,
    data_fechamento: `${mes}-10`,
    data_vencimento: `${mes}-17`,
    valor_total: valor,
  });
  const imports = [
    {
      id: "imp-1",
      credit_card_id: "card-1",
      status: "CONFIRMED",
      valor_total_fatura: 6577.67,
      data_vencimento: "2026-08-17",
      data_fechamento: "2026-08-10",
      periodo_fim: "2026-08-10",
      created_at: "2026-08-12",
    },
  ];

  it("separa ciclos reais, fatura em formação e projeções", () => {
    const ciclos = classificarCiclosDoCartao({
      invoices: [
        ciclo("2026-06"),
        ciclo("2026-07", "PAGA"),
        ciclo("2026-08"),
        ciclo("2026-09"),
        ciclo("2026-10"),
        ciclo("2027-05"),
      ],
      imports,
      hoje,
    });
    const estados = Object.fromEntries(ciclos.map((c) => [c.competencia, c.estado]));
    expect(estados).toEqual({
      "2026-06": "VENCIDA",
      "2026-07": "PAGA",
      "2026-08": "FECHADA",
      "2026-09": "EM_FORMACAO",
      "2026-10": "PROJETADA",
      "2027-05": "PROJETADA",
    });

    const grupos = agruparCiclos(ciclos);
    expect(grupos.atual?.competencia).toBe("2026-08");
    expect(grupos.atual?.valor).toBe(6577.67);
    expect(grupos.emFormacao?.competencia).toBe("2026-09");
    expect(grupos.projecoes).toHaveLength(2);
    expect(grupos.historico.map((c) => c.competencia)).toEqual(["2026-07", "2026-06"]);
  });
});

describe("progressoParcelamento", () => {
  const parcelas = (pagas: number, total = 8) =>
    Array.from({ length: total }, (_, i) => ({
      purchase_id: "p1",
      numero_parcela: i + 1,
      total_parcelas: total,
      valor_parcela: 77.34,
      data_vencimento: `2026-${String(8 + i).padStart(2, "0")}-17`,
      status: i < pagas ? "PAGO" : "PENDENTE",
    }));

  it("mantém a compra ativa após a primeira parcela paga", () => {
    const p = progressoParcelamento(parcelas(1))!;
    expect(p.estado).toBe("ATIVA");
    expect(p.pagas).toBe(1);
    expect(p.atual).toBe(2);
    expect(p.restantesQtd).toBe(7);
    expect(Math.round(p.restanteValor * 100) / 100).toBe(541.38);
  });

  it("marca como quitada só quando todas as parcelas foram pagas", () => {
    expect(progressoParcelamento(parcelas(8))!.estado).toBe("QUITADA");
  });
});
