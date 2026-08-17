/**
 * DUAS MÉTRICAS DISTINTAS — SOMENTE LEITURA, SEM GRAVAÇÃO.
 *
 * O mesmo período pode ser lido de duas formas, e misturar as duas mascara a
 * propagação de um erro:
 *
 *  A) VALIDAÇÃO ISOLADA (standalone)
 *     Cada mês começa no saldo inicial oficial impresso no próprio PDF.
 *     Serve para responder: "este documento fecha sozinho?".
 *
 *  B) VALIDAÇÃO ENCADEADA (chained)
 *     O fechamento calculado de um mês vira a abertura calculada do mês
 *     seguinte. Serve para responder: "o dinheiro do sistema bate com o banco
 *     ao longo do tempo?" — e é a única leitura válida para medir o impacto de
 *     um reparo, porque um movimento perdido em abril contamina todos os meses
 *     seguintes.
 *
 * Nenhuma linha deste arquivo grava, corrige ou altera valor, data ou sentido.
 */
import type { PersistenceRepairPlan, RepairPeriod } from "./persistence-repair";

const TOLERANCIA = 0.01;
const round = (n: number) => Math.round(n * 100) / 100;

export type StandalonePeriod = {
  importId: string;
  rotulo: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Abertura oficial impressa no próprio documento. */
  aberturaOficial: number | null;
  saldoDocumento: number | null;
  saldoAntes: number | null;
  saldoDepois: number | null;
  diferencaAntes: number | null;
  diferencaDepois: number | null;
  confereAntes: boolean | null;
  confereDepois: boolean | null;
};

export type ChainedPeriod = {
  importId: string;
  rotulo: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Abertura oficial do PDF — mostrada apenas para comparação. */
  aberturaOficial: number | null;
  /** Abertura herdada do fechamento calculado do mês anterior. */
  aberturaEncadeadaAntes: number | null;
  aberturaEncadeadaDepois: number | null;
  /** Soma dos movimentos que existem hoje no ledger dentro do período. */
  movimentoLedger: number;
  /** Efeito das linhas que o reparo restauraria neste período. */
  deltaReparo: number;
  saldoDocumento: number | null;
  saldoAntesRepair: number | null;
  saldoDepoisRepair: number | null;
  differenceBefore: number | null;
  differenceAfter: number | null;
  confereAntes: boolean | null;
  confereDepois: boolean | null;
  /** Período onde a linha ausente nasceria. */
  origemDaDiferenca: boolean;
};

export type StandaloneValidation = {
  metodo: "STANDALONE_OPENING_OFICIAL";
  descricao: string;
  periodos: StandalonePeriod[];
};

export type ChainedValidation = {
  metodo: "CHAINED_LEDGER";
  descricao: string;
  periodos: ChainedPeriod[];
  saldoFinalAntes: number | null;
  saldoFinalDepois: number | null;
  diferencaResidual: number | null;
  todosZeradosDepois: boolean;
};

export function buildStandaloneValidation(plan: PersistenceRepairPlan): StandaloneValidation {
  return {
    metodo: "STANDALONE_OPENING_OFICIAL",
    descricao:
      "Cada período é validado isoladamente, começando no saldo inicial oficial do próprio documento. Esta leitura NÃO mostra propagação de erro.",
    periodos: plan.periodos.map((p: RepairPeriod) => {
      // Diferença sempre no mesmo sentido do encadeado: sistema - documento.
      const difAntes =
        p.saldoDocumento === null || p.saldoAntes === null
          ? null
          : round(p.saldoAntes - p.saldoDocumento);
      const difDepois =
        p.saldoDocumento === null || p.saldoDepois === null
          ? null
          : round(p.saldoDepois - p.saldoDocumento);
      return {
        importId: p.importId,
        rotulo: p.rotulo,
        periodStart: p.periodStart,
        periodEnd: p.periodEnd,
        aberturaOficial: p.saldoInicial,
        saldoDocumento: p.saldoDocumento,
        saldoAntes: p.saldoAntes,
        saldoDepois: p.saldoDepois,
        diferencaAntes: difAntes,
        diferencaDepois: difDepois,
        confereAntes: difAntes === null ? null : Math.abs(difAntes) <= TOLERANCIA,
        confereDepois: difDepois === null ? null : Math.abs(difDepois) <= TOLERANCIA,
      };
    }),
  };
}

/**
 * Encadeia o ledger real de mês para mês: fechamento calculado de um período
 * vira a abertura calculada do próximo. É assim que a diferença de abril
 * aparece — corretamente — em maio, junho, julho e agosto.
 */
export function buildChainedValidation(plan: PersistenceRepairPlan): ChainedValidation {
  let aberturaAntes: number | null = null;
  let aberturaDepois: number | null = null;

  const periodos: ChainedPeriod[] = plan.periodos.map((p) => {
    // Primeiro período conhecido ancora no saldo inicial oficial do documento.
    if (aberturaAntes === null) aberturaAntes = p.saldoInicial;
    if (aberturaDepois === null) aberturaDepois = p.saldoInicial;

    const movimentoLedger =
      p.saldoAntes === null || p.saldoInicial === null ? 0 : round(p.saldoAntes - p.saldoInicial);

    const fechamentoAntes = aberturaAntes === null ? null : round(aberturaAntes + movimentoLedger);
    const fechamentoDepois =
      aberturaDepois === null ? null : round(aberturaDepois + movimentoLedger + p.deltaPeriodo);

    const difAntes =
      p.saldoDocumento === null || fechamentoAntes === null
        ? null
        : round(fechamentoAntes - p.saldoDocumento);
    const difDepois =
      p.saldoDocumento === null || fechamentoDepois === null
        ? null
        : round(fechamentoDepois - p.saldoDocumento);

    const linha: ChainedPeriod = {
      importId: p.importId,
      rotulo: p.rotulo,
      periodStart: p.periodStart,
      periodEnd: p.periodEnd,
      aberturaOficial: p.saldoInicial,
      aberturaEncadeadaAntes: aberturaAntes,
      aberturaEncadeadaDepois: aberturaDepois,
      movimentoLedger,
      deltaReparo: p.deltaPeriodo,
      saldoDocumento: p.saldoDocumento,
      saldoAntesRepair: fechamentoAntes,
      saldoDepoisRepair: fechamentoDepois,
      differenceBefore: difAntes,
      differenceAfter: difDepois,
      confereAntes: difAntes === null ? null : Math.abs(difAntes) <= TOLERANCIA,
      confereDepois: difDepois === null ? null : Math.abs(difDepois) <= TOLERANCIA,
      origemDaDiferenca: p.restauradas.length > 0,
    };

    aberturaAntes = fechamentoAntes;
    aberturaDepois = fechamentoDepois;
    return linha;
  });

  const ultimo = periodos[periodos.length - 1] ?? null;
  const comDocumento = periodos.filter((p) => p.saldoDocumento !== null);

  return {
    metodo: "CHAINED_LEDGER",
    descricao:
      "Fechamento calculado de um período vira a abertura calculada do seguinte. Esta é a leitura usada para medir o impacto do reparo.",
    periodos,
    saldoFinalAntes: ultimo?.saldoAntesRepair ?? null,
    saldoFinalDepois: ultimo?.saldoDepoisRepair ?? null,
    diferencaResidual: ultimo?.differenceAfter ?? null,
    todosZeradosDepois:
      comDocumento.length > 0 && comDocumento.every((p) => p.confereDepois === true),
  };
}

/**
 * Classificação DIAGNÓSTICA de saldo conferido. Não altera valor nem o tipo
 * gravado: apenas separa, na leitura, o saldo de fechamento do período dos
 * saldos do dia.
 */
export function classifyCheckpointDiagnostic(input: {
  data: string;
  saldo: number;
  tipoGravado: string | null;
  periodEnd: string | null;
  saldoDocumento: number | null;
  ehUltimoDoPeriodo: boolean;
}): "DAILY" | "CLOSING" {
  if (input.tipoGravado === "CLOSING") return "CLOSING";
  const fechaNoFimDoPeriodo = !!input.periodEnd && input.data === input.periodEnd;
  const bateComOSaldoFinal =
    input.saldoDocumento !== null && Math.abs(input.saldo - input.saldoDocumento) <= TOLERANCIA;
  if (input.ehUltimoDoPeriodo && (fechaNoFimDoPeriodo || bateComOSaldoFinal)) return "CLOSING";
  return "DAILY";
}
