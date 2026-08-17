/**
 * SELEÇÃO DO EXTRATO CANÔNICO — SOMENTE LEITURA.
 *
 * Quando o mesmo PDF é importado duas vezes, o auditor não pode tratar os dois
 * imports como extratos sequenciais: encadear 2026-06-30 → 2026-01-01 gera uma
 * falsa "quebra de continuidade" e dobra a contagem de checkpoints do documento.
 *
 * Aqui os imports são agrupados por PERÍODO IDÊNTICO (`SAME_PERIOD_OVERLAP`) e,
 * dentro de cada grupo, um único import é eleito CANÔNICO para validar o ledger.
 * Nada é gravado, apagado ou alterado: a eleição é puramente derivada.
 *
 * Critério de preferência (nesta ordem):
 *   1. snapshot canônico do parser presente e período completo;
 *   2. data do saldo anterior (OPENING) explícita e persistida;
 *   3. mais checkpoints diários persistidos;
 *   4. mais linhas ligadas ao ledger;
 *   5. import mais recente, quando os anteriores empatam.
 */

export type SelectionImportInput = {
  id: string;
  nome_arquivo?: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  saldo_inicial?: number | string | null;
  saldo_final?: number | string | null;
  parser?: string | null;
  status?: string | null;
  created_at?: string | null;
  dados_brutos_json?: unknown;
};

export type SelectionCheckpointInput = {
  data: string;
  saldo: number;
  tipo?: string | null;
  importId?: string | null;
};

export type SelectionItemInput = {
  import_id: string;
  incluir?: boolean | null;
  transaction_id_criada?: string | null;
  transaction_id_matched?: string | null;
};

export type StatementCandidate = {
  importId: string;
  nomeArquivo: string;
  periodStart: string | null;
  periodEnd: string | null;
  openingDate: string | null;
  openingBalance: number | null;
  closingBalance: number | null;
  parser: string | null;
  createdAt: string | null;
  temSnapshot: boolean;
  checkpointsPersistidos: number;
  checkpointsDaily: number;
  temOpeningPersistido: boolean;
  itens: number;
  itensLigados: number;
  score: number;
  motivos: string[];
  canonical: boolean;
};

export type StatementGroup = {
  chave: string;
  relacao: "SAME_PERIOD_OVERLAP" | "UNIQUE_PERIOD";
  periodStart: string | null;
  periodEnd: string | null;
  canonicalId: string | null;
  candidatos: StatementCandidate[];
};

export type StatementSelection = {
  importsEncontrados: number;
  grupos: StatementGroup[];
  canonicalIds: string[];
  /** Imports preservados, porém fora da continuidade e da contagem canônica. */
  duplicadosPreservados: string[];
  samePeriodOverlap: boolean;
  falseContinuityRemoved: boolean;
  canonicalCheckpoints: number;
};

function openingDateFromSnapshot(json: unknown): string | null {
  const snap = json as { openingBalance?: { date?: string | null } | null } | null;
  const d = snap?.openingBalance?.date;
  return typeof d === "string" ? d : null;
}

function num(v: number | string | null | undefined): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function buildStatementSelection(input: {
  imports: SelectionImportInput[];
  checkpoints: SelectionCheckpointInput[];
  statementItems?: SelectionItemInput[];
}): StatementSelection {
  const validos = input.imports.filter((i) => i.status !== "CANCELLED" && i.status !== "ERROR");

  const candidatos: StatementCandidate[] = validos.map((i) => {
    const doImport = input.checkpoints.filter((c) => c.importId === i.id);
    const daily = doImport.filter((c) => (c.tipo ?? "DAILY") === "DAILY").length;
    const opening = doImport.some((c) => c.tipo === "OPENING");
    const itens = (input.statementItems ?? []).filter((it) => it.import_id === i.id);
    const ligados = itens.filter(
      (it) => it.transaction_id_criada || it.transaction_id_matched,
    ).length;
    const snapshotOpening = openingDateFromSnapshot(i.dados_brutos_json);
    const temSnapshot = !!i.dados_brutos_json;

    const motivos: string[] = [];
    let score = 0;
    if (temSnapshot && i.periodo_inicio && i.periodo_fim) {
      score += 5;
      motivos.push("Snapshot canônico do parser presente com período completo");
    }
    if (opening && snapshotOpening) {
      score += 10;
      motivos.push(`Saldo anterior explícito e persistido (${snapshotOpening})`);
    } else if (snapshotOpening) {
      score += 2;
      motivos.push(`Saldo anterior no snapshot (${snapshotOpening}), mas não persistido`);
    }
    score += daily;
    if (daily) motivos.push(`${daily} checkpoint(s) diário(s) persistido(s)`);
    score += ligados * 0.1;
    if (ligados) motivos.push(`${ligados} linha(s) ligada(s) ao ledger`);

    return {
      importId: i.id,
      nomeArquivo: i.nome_arquivo ?? "extrato",
      periodStart: i.periodo_inicio,
      periodEnd: i.periodo_fim,
      openingDate: opening ? snapshotOpening : snapshotOpening ? null : null,
      openingBalance: num(i.saldo_inicial),
      closingBalance: num(i.saldo_final),
      parser: i.parser ?? null,
      createdAt: i.created_at ?? null,
      temSnapshot,
      checkpointsPersistidos: doImport.length,
      checkpointsDaily: daily,
      temOpeningPersistido: opening,
      itens: itens.length,
      itensLigados: ligados,
      score: Math.round(score * 100) / 100,
      motivos,
      canonical: false,
    };
  });

  const porChave = new Map<string, StatementCandidate[]>();
  for (const c of candidatos) {
    const chave = `${c.periodStart ?? "?"}|${c.periodEnd ?? "?"}`;
    porChave.set(chave, [...(porChave.get(chave) ?? []), c]);
  }

  const grupos: StatementGroup[] = [];
  for (const [chave, membros] of porChave) {
    const ordenados = [...membros].sort(
      (a, b) =>
        b.score - a.score ||
        String(b.createdAt ?? "").localeCompare(String(a.createdAt ?? "")) ||
        a.importId.localeCompare(b.importId),
    );
    const eleito = ordenados[0] ?? null;
    if (eleito) eleito.canonical = true;
    grupos.push({
      chave,
      relacao: membros.length > 1 ? "SAME_PERIOD_OVERLAP" : "UNIQUE_PERIOD",
      periodStart: eleito?.periodStart ?? null,
      periodEnd: eleito?.periodEnd ?? null,
      canonicalId: eleito?.importId ?? null,
      candidatos: ordenados,
    });
  }

  grupos.sort((a, b) => String(a.periodStart ?? "").localeCompare(String(b.periodStart ?? "")));

  const canonicalIds = grupos.map((g) => g.canonicalId).filter(Boolean) as string[];
  const duplicados = candidatos.filter((c) => !c.canonical).map((c) => c.importId);
  const samePeriodOverlap = grupos.some((g) => g.relacao === "SAME_PERIOD_OVERLAP");

  return {
    importsEncontrados: candidatos.length,
    grupos,
    canonicalIds,
    duplicadosPreservados: duplicados,
    samePeriodOverlap,
    falseContinuityRemoved: samePeriodOverlap,
    canonicalCheckpoints: candidatos
      .filter((c) => c.canonical)
      .reduce((acc, c) => acc + c.checkpointsDaily, 0),
  };
}
