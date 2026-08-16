/**
 * PERÍODO OFICIAL DE UM EXTRATO.
 *
 * Regra única: o mês de um extrato vem do PERÍODO do documento — nunca da data
 * do "Saldo Anterior", nunca da primeira/última movimentação e nunca do
 * primeiro checkpoint.
 *
 * O "Saldo Anterior" é apenas o OPENING_CHECKPOINT: ele fica FORA do período
 * (é o saldo do último dia anterior ao extrato) e não conta como saldo diário.
 *
 * Quando o documento foi importado sem período confiável (parsers antigos
 * gravaram a data do saldo anterior em period_start/period_end), o período é
 * reconstruído a partir dos checkpoints diários persistidos:
 *   início = dia seguinte ao saldo anterior
 *   fim    = último "Saldo do dia" do documento
 * O mês de referência é sempre o mês do FIM do período — é ele que nomeia o
 * extrato ("extrato de janeiro fecha em 31/01, mesmo abrindo em 30/12").
 */

export type CheckpointInput = {
  importId?: string | null;
  data: string;
  saldo: number;
};

export type StatementPeriodOrigin = "DOCUMENTO" | "CHECKPOINTS" | "INDEFINIDO";

export type ResolvedStatementPeriod = {
  inicio: string | null;
  fim: string | null;
  /** Mês que nomeia o extrato (YYYY-MM). */
  mesReferencia: string | null;
  /** Data do saldo anterior — metadata, fora do período. */
  aberturaData: string | null;
  origem: StatementPeriodOrigin;
  /** "Saldo do dia" DENTRO do período (o de abertura não entra). */
  checkpointsDiarios: { data: string; saldo: number }[];
};

const CONFERE = 0.02;

function addDays(iso: string, dias: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

export function resolveStatementPeriod(
  imp: {
    periodo_inicio: string | null;
    periodo_fim: string | null;
    saldo_inicial: number | string | null;
  },
  checkpoints: { data: string; saldo: number }[],
): ResolvedStatementPeriod {
  const ordenados = [...checkpoints].sort((a, b) => a.data.localeCompare(b.data));
  const saldoInicial = imp.saldo_inicial === null ? null : Number(imp.saldo_inicial);

  // OPENING_CHECKPOINT: o primeiro checkpoint que reproduz o saldo anterior.
  const primeiro = ordenados[0] ?? null;
  const abertura =
    primeiro &&
    (saldoInicial === null || Math.abs(primeiro.saldo - saldoInicial) <= CONFERE) &&
    ordenados.length > 1
      ? primeiro
      : null;
  const aberturaData = abertura?.data ?? null;
  const diarios = ordenados.filter((c) => !aberturaData || c.data > aberturaData);

  const inicioDoc = imp.periodo_inicio;
  const fimDoc = imp.periodo_fim;
  // Período do documento só vale quando é um intervalo de verdade e não é
  // simplesmente a data do saldo anterior repetida.
  const docConfiavel =
    !!inicioDoc &&
    !!fimDoc &&
    inicioDoc < fimDoc &&
    (!aberturaData || fimDoc > aberturaData);

  if (docConfiavel) {
    return {
      inicio: inicioDoc,
      fim: fimDoc,
      mesReferencia: fimDoc!.slice(0, 7),
      aberturaData,
      origem: "DOCUMENTO",
      checkpointsDiarios: diarios.filter((c) => c.data >= inicioDoc! && c.data <= fimDoc!),
    };
  }

  const fim = diarios[diarios.length - 1]?.data ?? null;
  if (!fim) {
    return {
      inicio: inicioDoc ?? null,
      fim: fimDoc ?? null,
      mesReferencia: (fimDoc ?? inicioDoc)?.slice(0, 7) ?? null,
      aberturaData,
      origem: "INDEFINIDO",
      checkpointsDiarios: diarios,
    };
  }

  const inicio = aberturaData ? addDays(aberturaData, 1) : `${fim.slice(0, 7)}-01`;
  return {
    inicio,
    fim,
    mesReferencia: fim.slice(0, 7),
    aberturaData,
    origem: "CHECKPOINTS",
    checkpointsDiarios: diarios,
  };
}

/** Agrupa checkpoints por importação, preservando a ordem cronológica. */
export function groupCheckpointsByImport(checkpoints: CheckpointInput[]) {
  const mapa = new Map<string, { data: string; saldo: number }[]>();
  for (const c of checkpoints) {
    if (!c.importId) continue;
    mapa.set(c.importId, [...(mapa.get(c.importId) ?? []), { data: c.data, saldo: c.saldo }]);
  }
  for (const [k, v] of mapa) mapa.set(k, v.sort((a, b) => a.data.localeCompare(b.data)));
  return mapa;
}
