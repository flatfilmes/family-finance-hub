import { describe, expect, it } from "vitest";
import { isStatementConfirmed } from "@/lib/card-statements";
import {
  agruparCiclos,
  composicaoUtilizado,
  classificarCiclosDoCartao,
  faturasFechadasEmAberto,
  obrigacaoAbertaDoCartao,
  linhasOficiaisDaFatura,
  resumoOficialDaFatura,
  type LancamentoOficial,
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

describe("composicaoUtilizado com fatura oficial", () => {
  it("substitui a estimativa pelo documento oficial sem somar as duas", () => {
    const c = composicaoUtilizado({
      utilizadoParcelas: 6000,
      faturaAtual: 5800.89,
      faturaOficial: 6577.67,
      parcelasFuturas: 199.11,
      comprasSemParcela: 0,
    });
    expect(c.faturaAtual).toBe(6577.67);
    expect(c.oficial).toBe(true);
    expect(c.total).toBe(6776.78);
  });

  it("sem documento oficial mantém a estimativa interna", () => {
    const c = composicaoUtilizado({
      utilizadoParcelas: 1000,
      faturaAtual: 800,
      parcelasFuturas: 200,
      comprasSemParcela: 50,
    });
    expect(c.faturaAtual).toBe(800);
    expect(c.total).toBe(1050);
  });
});

describe("resumo oficial da fatura fechada", () => {
  const item = (over: Partial<LancamentoOficial> & { id: string; valor: number }) =>
    ({
      data_lancamento: "2026-07-20",
      descricao_original: "LANCAMENTO",
      estabelecimento_sugerido: null,
      tipo_sugerido: "COMPRA",
      parcela_atual: null,
      total_parcelas: null,
      categoria_sugerida_id: null,
      purchase_id_criada: null,
      purchase_id_matched: null,
      recurring_expense_id_matched: null,
      ...over,
    }) as LancamentoOficial;

  it("fecha agosto/2026 no total oficial de 6577,67 mesmo sem purchase no ciclo", () => {
    const items: LancamentoOficial[] = [
      // compras à vista do ciclo
      item({ id: "1", valor: 5749.46 }),
      // parcelas de séries antigas: não têm parcela no ciclo interno
      item({ id: "2", valor: 216.74, parcela_atual: 8, total_parcelas: 12 }),
      item({ id: "3", valor: 143.24, parcela_atual: 3, total_parcelas: 3 }),
      item({ id: "4", valor: 96.82, parcela_atual: 2, total_parcelas: 2 }),
      item({ id: "5", valor: 56.53, parcela_atual: 9, total_parcelas: 12 }),
      item({ id: "6", valor: 52.58, parcela_atual: 7, total_parcelas: 10 }),
      item({ id: "7", valor: 51.17, parcela_atual: 9, total_parcelas: 10 }),
      item({ id: "8", valor: 22.72, parcela_atual: 9, total_parcelas: 12 }),
      item({ id: "9", valor: 136.98 }),
      // taxas e serviços
      item({ id: "10", valor: 46.0, tipo_sugerido: "TAXA" }),
      item({ id: "11", valor: 0.54, tipo_sugerido: "TAXA" }),
      item({ id: "12", valor: 4.94, tipo_sugerido: "TAXA" }),
      // créditos
      item({ id: "13", valor: -0.01, tipo_sugerido: "ESTORNO" }),
      item({ id: "14", valor: -0.04, tipo_sugerido: "ESTORNO" }),
    ];
    const linhas = linhasOficiaisDaFatura({ items, vencimento: "2026-08-17" });
    const r = resumoOficialDaFatura(linhas);
    expect(r.taxas).toBe(51.48);
    expect(r.creditos).toBe(-0.05);
    expect(r.parceladas).toBe(639.8);
    expect(r.total).toBe(6577.67);
  });
});
