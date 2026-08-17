/**
 * PLANO DE REPARO DA PERSISTÊNCIA — SOMENTE LEITURA, SOMENTE SIMULAÇÃO.
 *
 * Este módulo NÃO grava, NÃO corrige, NÃO recria movimento e NÃO altera saldo.
 * Ele responde, por período do documento, exatamente três perguntas:
 *
 *   1. Quantos movimentos o documento tem, quantos chegaram ao extrato do
 *      sistema e quais linhas exatas ficaram pelo caminho (com sourceId).
 *   2. Qual seria o saldo final do período se essas linhas voltassem — e
 *      quanto a diferença contra o documento cai.
 *   3. O que é apenas metadado ausente (retrato canônico, identidade de linha,
 *      tipo de saldo) e portanto não muda um centavo.
 *
 * A existência econômica lida do PDF é intocável: nada aqui reinterpreta valor,
 * data ou sentido de qualquer lançamento.
 */
import { movementEffect } from "@/lib/bank-ledger";
import type { Transaction } from "@/lib/transactions";
import type { LineageImportInput, LineageItemInput, LineageRow, StatementLineage } from "./lineage";
import { classifyCheckpointDiagnostic } from "./chained-validation";

const CONFERE = 0.01;

function round(n: number) {
  return Math.round(n * 100) / 100;
}

export type RestoredLine = {
  itemId: string;
  sourceId: string;
  ordem: number;
  data: string | null;
  descricao: string;
  valor: number;
  direcao: "IN" | "OUT";
  /** Efeito no saldo da conta se a linha for restaurada. */
  deltaSaldo: number;
  reviewAction: string;
  matchStatus: string;
  motivo: string;
};

export type CheckpointComparison = {
  data: string;
  saldoInformado: number;
  saldoAtual: number | null;
  saldoSimulado: number | null;
  confereAntes: boolean;
  confereDepois: boolean;
  tipo: string | null;
  /** Classificação diagnóstica (não altera o tipo gravado nem o saldo). */
  tipoDiagnostico: "DAILY" | "CLOSING";
};

export type TransferEvidence = {
  itemId: string;
  sourceId: string;
  data: string | null;
  descricao: string;
  valor: number;
  transferGroupId: string | null;
  /** Contrapartida real encontrada no ledger de outra conta. */
  contrapartida: {
    transactionId: string;
    accountId: string | null;
    data: string;
    valor: number;
  } | null;
  veredito: "COMPROVADA" | "SEM_CONTRAPARTIDA";
};

export type RepairPeriod = {
  importId: string;
  nomeArquivo: string;
  periodStart: string | null;
  periodEnd: string | null;
  rotulo: string;
  movimentosDocumento: number;
  movimentosAntes: number;
  movimentosDepois: number;
  saldoInicial: number | null;
  saldoDocumento: number | null;
  saldoAntes: number | null;
  saldoDepois: number | null;
  diferencaAntes: number | null;
  diferencaDepois: number | null;
  deltaPeriodo: number;
  restauradas: RestoredLine[];
  checkpoints: CheckpointComparison[];
  checkpointsConferemAntes: number;
  checkpointsConferemDepois: number;
  transferencias: TransferEvidence[];
};

export type ImportMetadata = {
  importId: string;
  nomeArquivo: string;
  periodo: string;
  snapshotCanonico: boolean;
  linhas: number;
  linhasSemIdentidade: number;
  checkpoints: number;
  checkpointsSemTipo: number;
  checkpointsSemOrigem: number;
  /** Backfill de metadado nunca move dinheiro. */
  impactoFinanceiro: 0;
  acoes: string[];
};

/** Import equivalente preservado, porém fora de qualquer candidato financeiro. */
export type OverlapImport = {
  importId: string;
  nomeArquivo: string;
  periodStart: string | null;
  periodEnd: string | null;
  relacao: "SAME_PERIOD_OVERLAP";
  papel: "NON_CANONICAL_SOURCE";
  canonicalId: string | null;
  linhas: number;
  /** Snapshot repetido do mesmo extrato nunca move dinheiro. */
  impactoFinanceiro: 0;
  motivo: string;
};

/** Linha do documento que já existe no ledger por outro import equivalente. */
export type AlreadyPresentLine = {
  importId: string;
  itemId: string;
  sourceId: string;
  data: string | null;
  descricao: string;
  valor: number;
  direcao: "IN" | "OUT";
  veredito: "ALREADY_PRESENT_VIA_OTHER_IMPORT";
};

export type PersistenceRepairPlan = {
  geradoEm: string;
  dryRun: true;
  accountId: string;
  /** Eleição do extrato canônico — só ele gera candidatos financeiros. */
  statements: {
    encontrados: number;
    canonicalIds: string[];
    overlaps: OverlapImport[];
    samePeriodOverlap: boolean;
  };
  jaPresentes: AlreadyPresentLine[];
  periodos: RepairPeriod[];
  metadados: ImportMetadata[];
  totais: {
    movimentosDocumento: number;
    movimentosAntes: number;
    movimentosDepois: number;
    linhasRestauradas: number;
    deltaSaldoAtual: number;
    importsSemSnapshot: number;
    linhasSemIdentidade: number;
    checkpointsSemTipo: number;
    statementsEncontrados: number;
    statementsCanonicos: number;
    overlapsPreservados: number;
    jaPresentesEmOutroImport: number;
  };

};

const MOTIVO_DUPLICATA =
  "Descartado como duplicata sem alvo concreto — a repetição é legítima no documento.";
const MOTIVO_AUSENTE =
  "O documento traz o lançamento, mas não existe movimento correspondente no extrato do sistema.";

function periodLabel(inicio: string | null, fim: string | null) {
  if (!inicio) return fim ?? "Período desconhecido";
  const [ano, mes] = inicio.split("-");
  const nomes = [
    "Janeiro",
    "Fevereiro",
    "Março",
    "Abril",
    "Maio",
    "Junho",
    "Julho",
    "Agosto",
    "Setembro",
    "Outubro",
    "Novembro",
    "Dezembro",
  ];
  const idx = Number(mes) - 1;
  return `${nomes[idx] ?? mes}/${ano}`;
}

function toRestored(r: LineageRow, motivo: string): RestoredLine {
  return {
    itemId: r.itemId,
    sourceId: r.sourceId,
    ordem: r.ordem,
    data: r.postingDate,
    descricao: r.description,
    valor: r.amount,
    direcao: r.direction,
    deltaSaldo: r.direction === "IN" ? r.amount : -r.amount,
    reviewAction: r.reviewAction,
    matchStatus: r.reconciliationStatus,
    motivo,
  };
}

export function buildPersistenceRepairPlan(input: {
  accountId: string;
  lineages: StatementLineage[];
  imports: LineageImportInput[];
  items: LineageItemInput[];
  transactions: Transaction[];
  allTransactions: Transaction[];
  checkpoints: {
    id?: string | null;
    data: string;
    saldo: number;
    tipo?: string | null;
    rotulo?: string | null;
    importId?: string | null;
    sourceItemId?: string | null;
  }[];
}): PersistenceRepairPlan {
  const doLedger = input.transactions.filter(
    (t) => t.bank_account_id === input.accountId && t.status !== "CANCELADA",
  );
  const impById = new Map(input.imports.map((i) => [i.id, i]));

  // ---------- eleição do extrato canônico ----------
  // Reimportar o MESMO extrato não cria movimento econômico novo: imports com
  // período idêntico são agrupados e só o canônico participa da contagem, dos
  // checkpoints, do saldo e dos candidatos de reparo.
  const selecao = buildStatementSelection({
    imports: input.imports.map((i) => ({
      id: i.id,
      nome_arquivo: i.nome_arquivo,
      periodo_inicio: i.periodo_inicio,
      periodo_fim: i.periodo_fim,
      saldo_inicial: i.saldo_inicial ?? null,
      saldo_final: i.saldo_final ?? null,
      status: i.status ?? null,
      created_at: i.created_at ?? null,
      dados_brutos_json: i.dados_brutos_json,
    })),
    checkpoints: input.checkpoints.map((c) => ({
      data: c.data,
      saldo: c.saldo,
      tipo: c.tipo ?? null,
      importId: c.importId ?? null,
    })),
    statementItems: input.items.map((i) => ({
      import_id: i.import_id,
      incluir: i.incluir ?? null,
      transaction_id_criada: i.transaction_id_criada ?? null,
      transaction_id_matched: i.transaction_id_matched ?? null,
    })),
  });
  const canonicalIds = new Set(selecao.canonicalIds);

  const overlaps: OverlapImport[] = selecao.grupos
    .filter((g) => g.relacao === "SAME_PERIOD_OVERLAP")
    .flatMap((g) =>
      g.candidatos
        .filter((c) => !c.canonical)
        .map((c) => ({
          importId: c.importId,
          nomeArquivo: c.nomeArquivo,
          periodStart: c.periodStart,
          periodEnd: c.periodEnd,
          relacao: "SAME_PERIOD_OVERLAP" as const,
          papel: "NON_CANONICAL_SOURCE" as const,
          canonicalId: g.canonicalId,
          linhas: c.itens,
          impactoFinanceiro: 0 as const,
          motivo:
            "Snapshot do MESMO extrato já representado pelo import canônico. Preservado como documento histórico; não gera restauração nem contagem própria.",
        })),
    );

  // Existência econômica atual da conta — base para provar presença real.
  const presenca = createPresenceLedger(
    doLedger
      .filter((t) => t.tipo !== "ABERTURA_SALDO" && t.tipo !== "AJUSTE_SALDO")
      .map((t) => ({
        data: t.data_movimento,
        valor: Math.abs(Number(t.valor) || 0),
        direcao: movementEffect(t) >= 0 ? ("IN" as const) : ("OUT" as const),
        descricao: t.descricao ?? null,
      })),
  );
  // Linhas já ligadas ao ledger consomem a capacidade antes dos candidatos.
  for (const lin of input.lineages) {
    if (!canonicalIds.has(lin.importId)) continue;
    for (const r of lin.rows) {
      if (!r.ledgerTransactionId) continue;
      presenca.consume({
        data: r.postingDate,
        valor: Math.abs(r.amount),
        direcao: r.direction,
        descricao: r.description,
      });
    }
  }

  const jaPresentes: AlreadyPresentLine[] = [];

  const ordenados = [...input.lineages]
    .filter((l) => canonicalIds.has(l.importId))
    .sort((a, b) => String(a.periodStart ?? "").localeCompare(String(b.periodStart ?? "")));

  const periodos: RepairPeriod[] = [];
  let acumulado = 0;

  for (const lin of ordenados) {
    const imp = impById.get(lin.importId);
    const inicio = lin.periodStart;
    const fim = lin.periodEnd;

    const perdidos = lin.rows.filter(
      (r) => r.finalStatus === "SKIPPED_DUPLICATE" && !r.matchedAgainst,
    );
    const ausentes = lin.missingFromLedger.filter(
      (r) => r.finalStatus !== "SKIPPED_DUPLICATE" && r.finalStatus !== "REJECTED",
    );
    const candidatas = [
      ...perdidos.map((r) => toRestored(r, MOTIVO_DUPLICATA)),
      ...ausentes.map((r) => toRestored(r, MOTIVO_AUSENTE)),
    ].sort((a, b) => String(a.data ?? "").localeCompare(String(b.data ?? "")));

    // Ausência de vínculo NÃO é ausência econômica: se o fato já existe no
    // ledger, a linha é marcada como presente e nunca vira restauração.
    const restauradas = candidatas.filter((l) => {
      const presente = presenca.consume({
        data: l.data,
        valor: Math.abs(l.valor),
        direcao: l.direcao,
        descricao: l.descricao,
      });
      if (presente) {
        jaPresentes.push({
          importId: lin.importId,
          itemId: l.itemId,
          sourceId: l.sourceId,
          data: l.data,
          descricao: l.descricao,
          valor: l.valor,
          direcao: l.direcao,
          veredito: "ALREADY_PRESENT_VIA_OTHER_IMPORT",
        });
      }
      return !presente;
    });


    const deltaPeriodo = round(restauradas.reduce((acc, l) => acc + l.deltaSaldo, 0));
    acumulado = round(acumulado + deltaPeriodo);

    const saldoInicial =
      imp?.saldo_inicial === null || imp?.saldo_inicial === undefined
        ? null
        : Number(imp.saldo_inicial);
    const saldoDocumento =
      imp?.saldo_final === null || imp?.saldo_final === undefined ? null : Number(imp.saldo_final);

    // Saldo dia a dia SOMENTE do que existe hoje no ledger.
    const doPeriodo = doLedger
      .filter(
        (t) =>
          t.tipo !== "ABERTURA_SALDO" &&
          t.tipo !== "AJUSTE_SALDO" &&
          (!inicio || t.data_movimento >= inicio) &&
          (!fim || t.data_movimento <= fim),
      )
      .sort((a, b) => a.data_movimento.localeCompare(b.data_movimento));

    const saldoAtualPorDia = new Map<string, number>();
    let saldo = saldoInicial ?? 0;
    for (const t of doPeriodo) {
      saldo = round(saldo + movementEffect(t));
      saldoAtualPorDia.set(t.data_movimento, saldo);
    }
    const saldoAntes = saldoInicial === null ? null : saldo;

    // Mesma varredura, agora com as linhas restauradas na data original.
    type Ev = { data: string; efeito: number };
    const eventos: Ev[] = [
      ...doPeriodo.map((t) => ({ data: t.data_movimento, efeito: movementEffect(t) })),
      ...restauradas
        .filter((l) => !!l.data)
        .map((l) => ({ data: l.data as string, efeito: l.deltaSaldo })),
    ].sort((a, b) => a.data.localeCompare(b.data));
    const saldoSimuladoPorDia = new Map<string, number>();
    let saldoSim = saldoInicial ?? 0;
    for (const e of eventos) {
      saldoSim = round(saldoSim + e.efeito);
      saldoSimuladoPorDia.set(e.data, saldoSim);
    }
    const saldoDepois = saldoInicial === null ? null : saldoSim;

    const doImport = input.checkpoints
      .filter((c) => c.importId === lin.importId)
      .filter((c) => (!inicio || c.data >= inicio) && (!fim || c.data <= fim))
      .sort((a, b) => a.data.localeCompare(b.data));

    const checkpoints: CheckpointComparison[] = doImport.map((c, idx) => {
      const atual = saldoAtualPorDia.get(c.data) ?? null;
      const simulado = saldoSimuladoPorDia.get(c.data) ?? null;
      return {
        data: c.data,
        saldoInformado: c.saldo,
        saldoAtual: atual,
        saldoSimulado: simulado,
        confereAntes: atual !== null && Math.abs(atual - c.saldo) <= CONFERE,
        confereDepois: simulado !== null && Math.abs(simulado - c.saldo) <= CONFERE,
        tipo: c.tipo ?? null,
        tipoDiagnostico: classifyCheckpointDiagnostic({
          data: c.data,
          saldo: c.saldo,
          tipoGravado: c.tipo ?? null,
          periodEnd: fim,
          saldoDocumento,
          ehUltimoDoPeriodo: idx === doImport.length - 1,
        }),
      };
    });

    // Transferências automáticas: prova é a contrapartida real em outra conta.
    const transferencias: TransferEvidence[] = lin.rows
      .filter((r) => r.reviewAction === "MATCH_TRANSFER")
      .map((r) => {
        const propria = doLedger.find((t) => t.id === r.ledgerTransactionId) ?? null;
        const groupId = propria?.transfer_group_id ?? null;
        const par = groupId
          ? input.allTransactions.find(
              (t) =>
                t.transfer_group_id === groupId &&
                t.id !== propria?.id &&
                t.status !== "CANCELADA",
            ) ?? null
          : null;
        return {
          itemId: r.itemId,
          sourceId: r.sourceId,
          data: r.postingDate,
          descricao: r.description,
          valor: r.amount,
          transferGroupId: groupId,
          contrapartida: par
            ? {
                transactionId: par.id,
                accountId: par.bank_account_id ?? null,
                data: par.data_movimento,
                valor: Number(par.valor),
              }
            : null,
          veredito: par ? ("COMPROVADA" as const) : ("SEM_CONTRAPARTIDA" as const),
        };
      });

    periodos.push({
      importId: lin.importId,
      nomeArquivo: lin.nomeArquivo,
      periodStart: inicio,
      periodEnd: fim,
      rotulo: periodLabel(inicio, fim),
      movimentosDocumento: lin.parsedTransactions,
      movimentosAntes: lin.persistedTransactions,
      movimentosDepois: lin.persistedTransactions + restauradas.length,
      saldoInicial,
      saldoDocumento,
      saldoAntes,
      saldoDepois,
      diferencaAntes:
        saldoDocumento === null || saldoAntes === null ? null : round(saldoDocumento - saldoAntes),
      diferencaDepois:
        saldoDocumento === null || saldoDepois === null ? null : round(saldoDocumento - saldoDepois),
      deltaPeriodo,
      restauradas,
      checkpoints,
      checkpointsConferemAntes: checkpoints.filter((c) => c.confereAntes).length,
      checkpointsConferemDepois: checkpoints.filter((c) => c.confereDepois).length,
      transferencias,
    });
  }

  const metadados: ImportMetadata[] = input.imports
    .slice()
    .sort((a, b) => String(a.periodo_inicio ?? "").localeCompare(String(b.periodo_inicio ?? "")))
    .map((imp) => {
      const snapshot = imp.dados_brutos_json as { snapshotVersion?: number } | null;
      const temSnapshot = !!snapshot && snapshot.snapshotVersion === 1;
      const linhas = input.items.filter((i) => i.import_id === imp.id);
      const semId = linhas.filter((i) => !i.source_id).length;
      const cps = input.checkpoints.filter((c) => c.importId === imp.id);
      const semTipo = cps.filter((c) => !c.tipo).length;
      const semOrigem = cps.filter((c) => !c.sourceItemId).length;
      const acoes: string[] = [];
      if (!temSnapshot) acoes.push("Regravar o retrato canônico do documento (sem tocar em movimento)");
      if (semId) acoes.push(`Atribuir identidade de linha a ${semId} lançamento(s)`);
      if (semTipo) acoes.push(`Classificar o tipo de ${semTipo} saldo conferido`);
      if (semOrigem) acoes.push(`Registrar a origem de ${semOrigem} saldo conferido`);
      return {
        importId: imp.id,
        nomeArquivo: imp.nome_arquivo,
        periodo: periodLabel(imp.periodo_inicio, imp.periodo_fim),
        snapshotCanonico: temSnapshot,
        linhas: linhas.length,
        linhasSemIdentidade: semId,
        checkpoints: cps.length,
        checkpointsSemTipo: semTipo,
        checkpointsSemOrigem: semOrigem,
        impactoFinanceiro: 0 as const,
        acoes,
      };
    });

  return {
    geradoEm: new Date().toISOString(),
    dryRun: true,
    accountId: input.accountId,
    statements: {
      encontrados: selecao.importsEncontrados,
      canonicalIds: selecao.canonicalIds,
      overlaps,
      samePeriodOverlap: selecao.samePeriodOverlap,
    },
    jaPresentes,
    periodos,
    metadados,
    totais: {
      movimentosDocumento: periodos.reduce((a, p) => a + p.movimentosDocumento, 0),
      movimentosAntes: periodos.reduce((a, p) => a + p.movimentosAntes, 0),
      movimentosDepois: periodos.reduce((a, p) => a + p.movimentosDepois, 0),
      linhasRestauradas: periodos.reduce((a, p) => a + p.restauradas.length, 0),
      deltaSaldoAtual: acumulado,
      importsSemSnapshot: metadados.filter((m) => !m.snapshotCanonico).length,
      linhasSemIdentidade: metadados.reduce((a, m) => a + m.linhasSemIdentidade, 0),
      checkpointsSemTipo: metadados.reduce((a, m) => a + m.checkpointsSemTipo, 0),
      statementsEncontrados: selecao.importsEncontrados,
      statementsCanonicos: selecao.canonicalIds.length,
      overlapsPreservados: overlaps.length,
      jaPresentesEmOutroImport: jaPresentes.length,
    },

  };
}

function csvCell(v: unknown) {
  const s = v === null || v === undefined ? "" : String(v);
  return `"${s.replace(/"/g, '""')}"`;
}

/** Exportação tabular do plano — mesma informação que a tela mostra. */
export function repairPlanToCsv(plan: PersistenceRepairPlan) {
  const linhas: string[] = [];
  linhas.push(
    [
      "secao",
      "periodo",
      "arquivo",
      "chave",
      "descricao",
      "antes",
      "depois",
      "diferenca",
      "observacao",
    ]
      .map(csvCell)
      .join(","),
  );

  for (const p of plan.periodos) {
    linhas.push(
      [
        "RESUMO",
        p.rotulo,
        p.nomeArquivo,
        "movimentos",
        `Documento ${p.movimentosDocumento}`,
        p.movimentosAntes,
        p.movimentosDepois,
        p.movimentosDepois - p.movimentosAntes,
        "",
      ]
        .map(csvCell)
        .join(","),
    );
    linhas.push(
      [
        "RESUMO",
        p.rotulo,
        p.nomeArquivo,
        "saldo_final",
        `Documento ${p.saldoDocumento ?? ""}`,
        p.saldoAntes ?? "",
        p.saldoDepois ?? "",
        p.diferencaDepois ?? "",
        `diferenca antes ${p.diferencaAntes ?? ""}`,
      ]
        .map(csvCell)
        .join(","),
    );
    for (const r of p.restauradas) {
      linhas.push(
        [
          "LINHA_RESTAURADA",
          p.rotulo,
          p.nomeArquivo,
          r.sourceId,
          `${r.data ?? ""} ${r.descricao}`,
          "ausente",
          "restaurada",
          r.deltaSaldo,
          `${r.reviewAction}/${r.matchStatus} · item ${r.itemId} · ${r.motivo}`,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    for (const c of p.checkpoints) {
      linhas.push(
        [
          "CHECKPOINT",
          p.rotulo,
          p.nomeArquivo,
          c.data,
          `informado ${c.saldoInformado}`,
          c.saldoAtual ?? "",
          c.saldoSimulado ?? "",
          "",
          `${c.confereAntes ? "confere" : "diverge"} → ${c.confereDepois ? "confere" : "diverge"}`,
        ]
          .map(csvCell)
          .join(","),
      );
    }
    for (const t of p.transferencias) {
      linhas.push(
        [
          "TRANSFERENCIA",
          p.rotulo,
          p.nomeArquivo,
          t.sourceId,
          `${t.data ?? ""} ${t.descricao}`,
          t.valor,
          t.veredito,
          0,
          t.contrapartida
            ? `par ${t.contrapartida.transactionId} em ${t.contrapartida.accountId ?? ""}`
            : "sem contrapartida no ledger",
        ]
          .map(csvCell)
          .join(","),
      );
    }
  }

  for (const m of plan.metadados) {
    linhas.push(
      [
        "METADADO",
        m.periodo,
        m.nomeArquivo,
        m.importId,
        m.snapshotCanonico ? "retrato canônico presente" : "retrato canônico ausente",
        `${m.linhasSemIdentidade}/${m.linhas} linhas sem identidade`,
        `${m.checkpointsSemTipo}/${m.checkpoints} saldos sem tipo`,
        0,
        m.acoes.join(" | "),
      ]
        .map(csvCell)
        .join(","),
    );
  }

  return linhas.join("\n");
}
