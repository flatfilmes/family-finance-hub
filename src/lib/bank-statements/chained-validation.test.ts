import { describe, expect, it } from "vitest";

import {
  buildChainedValidation,
  buildStandaloneValidation,
  classifyCheckpointDiagnostic,
} from "./chained-validation";
import type { PersistenceRepairPlan, RepairPeriod } from "./persistence-repair";

function periodo(p: Partial<RepairPeriod> & { rotulo: string }): RepairPeriod {
  return {
    importId: p.rotulo,
    nomeArquivo: `${p.rotulo}.pdf`,
    periodStart: null,
    periodEnd: null,
    movimentosDocumento: 0,
    movimentosAntes: 0,
    movimentosDepois: 0,
    saldoInicial: null,
    saldoDocumento: null,
    saldoAntes: null,
    saldoDepois: null,
    diferencaAntes: null,
    diferencaDepois: null,
    deltaPeriodo: 0,
    restauradas: [],
    checkpoints: [],
    checkpointsConferemAntes: 0,
    checkpointsConferemDepois: 0,
    transferencias: [],
    ...p,
  } as RepairPeriod;
}

/** Março fecha certo; abril perde uma saída de 54,61 e contamina o que vem depois. */
const plan = {
  geradoEm: "",
  dryRun: true,
  accountId: "conta",
  metadados: [],
  totais: {
    movimentosDocumento: 0,
    movimentosAntes: 0,
    movimentosDepois: 0,
    linhasRestauradas: 1,
    deltaSaldoAtual: -54.61,
    importsSemSnapshot: 0,
    linhasSemIdentidade: 0,
    checkpointsSemTipo: 0,
  },
  periodos: [
    periodo({ rotulo: "Março", saldoInicial: 649.63, saldoAntes: 678.57, saldoDocumento: 678.57 }),
    periodo({
      rotulo: "Abril",
      saldoInicial: 678.57,
      saldoAntes: 555.2,
      saldoDocumento: 500.59,
      deltaPeriodo: -54.61,
      restauradas: [{} as never],
    }),
    periodo({ rotulo: "Maio", saldoInicial: 500.59, saldoAntes: 91.28, saldoDocumento: 91.28 }),
    periodo({ rotulo: "Junho", saldoInicial: 91.28, saldoAntes: 274.57, saldoDocumento: 274.57 }),
  ],
} as unknown as PersistenceRepairPlan;

describe("validação encadeada vs isolada", () => {
  it("propaga a diferença de abril para os meses seguintes", () => {
    const c = buildChainedValidation(plan);
    expect(c.periodos.map((p) => p.saldoAntesRepair)).toEqual([678.57, 555.2, 145.89, 329.18]);
    expect(c.periodos.map((p) => p.differenceBefore)).toEqual([0, 54.61, 54.61, 54.61]);
  });

  it("zera todas as diferenças depois de restaurar a linha ausente", () => {
    const c = buildChainedValidation(plan);
    expect(c.periodos.map((p) => p.saldoDepoisRepair)).toEqual([678.57, 500.59, 91.28, 274.57]);
    expect(c.periodos.every((p) => p.differenceAfter === 0)).toBe(true);
    expect(c.todosZeradosDepois).toBe(true);
  });

  it("a leitura isolada não enxerga a propagação — por isso é métrica separada", () => {
    const s = buildStandaloneValidation(plan);
    expect(s.periodos.map((p) => p.saldoAntes)).toEqual([678.57, 555.2, 91.28, 274.57]);
    expect(s.periodos.filter((p) => p.confereAntes === false).map((p) => p.rotulo)).toEqual([
      "Abril",
    ]);
  });

  it("separa saldo do dia do saldo de fechamento no diagnóstico", () => {
    const base = { tipoGravado: null, periodEnd: "2026-04-30", saldoDocumento: 500.59 };
    expect(
      classifyCheckpointDiagnostic({
        ...base,
        data: "2026-04-15",
        saldo: 120,
        ehUltimoDoPeriodo: false,
      }),
    ).toBe("DAILY");
    expect(
      classifyCheckpointDiagnostic({
        ...base,
        data: "2026-04-30",
        saldo: 500.59,
        ehUltimoDoPeriodo: true,
      }),
    ).toBe("CLOSING");
  });
});
