/**
 * PLANO DE REPARO — SOMENTE DRY RUN.
 *
 * Este módulo NÃO grava, NÃO corrige e NÃO recria movimento algum. Ele apenas
 * compara o que o pipeline pós-parser deixou no banco com as regras novas
 * (identidade por sourceId, ocorrência ordinal, transferência com evidência
 * financeira, snapshot canônico e checkpoints tipados) e descreve, item a item,
 * o que precisaria ser feito.
 *
 * Nada aqui reinterpreta a existência econômica: um lançamento válido do PDF
 * permanece válido, aconteça o que acontecer nas camadas seguintes.
 */
import type { StatementLineage, LineageImportInput, LineageItemInput } from "./lineage";

export type RepairActionKind =
  | "BACKFILL_SNAPSHOT"
  | "BACKFILL_SOURCE_ID"
  | "BACKFILL_CHECKPOINT_TYPE"
  | "REVIEW_LOST_MOVEMENT"
  | "REVIEW_UNPROVEN_TRANSFER";

export const REPAIR_LABELS: Record<RepairActionKind, string> = {
  BACKFILL_SNAPSHOT: "Regravar o retrato do documento",
  BACKFILL_SOURCE_ID: "Atribuir identidade de linha",
  BACKFILL_CHECKPOINT_TYPE: "Classificar tipo de saldo",
  REVIEW_LOST_MOVEMENT: "Movimento perdido — precisa de decisão",
  REVIEW_UNPROVEN_TRANSFER: "Transferência sem comprovação — precisa de decisão",
};

export type RepairSeverity = "INFO" | "ATENCAO" | "CRITICO";

export type RepairAction = {
  kind: RepairActionKind;
  severity: RepairSeverity;
  importId: string;
  nomeArquivo: string;
  /** Alvos concretos (ids) que seriam tocados se o reparo fosse executado. */
  targetIds: string[];
  quantidade: number;
  /** Impacto financeiro em reais; 0 quando o reparo é só de metadado. */
  valorEnvolvido: number;
  motivo: string;
  /** O que exatamente mudaria — descrito para conferência humana. */
  efeito: string;
  /** Reparos financeiros nunca são automáticos. */
  exigeConfirmacaoHumana: boolean;
};

export type RepairPlan = {
  geradoEm: string;
  dryRun: true;
  acoes: RepairAction[];
  resumo: {
    total: number;
    metadados: number;
    financeiros: number;
    valorEnvolvido: number;
  };
};

/** Constrói o plano — função pura, sem I/O e sem efeito colateral. */
export function buildRepairPlan(input: {
  lineages: StatementLineage[];
  imports: LineageImportInput[];
  items: LineageItemInput[];
  checkpoints: { id?: string | null; data: string; tipo?: string | null; importId?: string | null }[];
}): RepairPlan {
  const acoes: RepairAction[] = [];
  const nomePorImport = new Map(input.imports.map((i) => [i.id, i.nome_arquivo ?? i.id]));

  for (const imp of input.imports) {
    const nomeArquivo = imp.nome_arquivo ?? imp.id;
    const snapshot = imp.dados_brutos_json as { snapshotVersion?: number } | null;
    if (!snapshot || snapshot.snapshotVersion !== 1) {
      acoes.push({
        kind: "BACKFILL_SNAPSHOT",
        severity: "ATENCAO",
        importId: imp.id,
        nomeArquivo,
        targetIds: [imp.id],
        quantidade: 1,
        valorEnvolvido: 0,
        motivo:
          "A importação não guardou o retrato canônico do documento, então a auditoria não consegue provar o que o PDF dizia.",
        efeito:
          "Reprocessar o PDF em memória e gravar o retrato (saldos, datas e linhas) sem tocar em nenhum movimento.",
        exigeConfirmacaoHumana: false,
      });
    }
  }

  const itensSemIdentidade = input.items.filter((i) => !i.source_id);
  const porImport = new Map<string, LineageItemInput[]>();
  for (const it of itensSemIdentidade) {
    porImport.set(it.import_id, [...(porImport.get(it.import_id) ?? []), it]);
  }
  for (const [importId, itens] of porImport) {
    acoes.push({
      kind: "BACKFILL_SOURCE_ID",
      severity: "INFO",
      importId,
      nomeArquivo: nomePorImport.get(importId) ?? importId,
      targetIds: itens.map((i) => i.id),
      quantidade: itens.length,
      valorEnvolvido: 0,
      motivo:
        "Linhas antigas foram gravadas antes da identidade por linha e só podem ser rastreadas por data + valor + descrição.",
      efeito:
        "Preencher a identidade e a ordem de ocorrência de cada linha. Valor, data e descrição continuam intactos.",
      exigeConfirmacaoHumana: false,
    });
  }

  const semTipo = input.checkpoints.filter((c) => !c.tipo);
  if (semTipo.length) {
    acoes.push({
      kind: "BACKFILL_CHECKPOINT_TYPE",
      severity: "INFO",
      importId: semTipo[0]?.importId ?? "",
      nomeArquivo: nomePorImport.get(semTipo[0]?.importId ?? "") ?? "Vários extratos",
      targetIds: semTipo.map((c) => c.id ?? c.data),
      quantidade: semTipo.length,
      valorEnvolvido: 0,
      motivo:
        "Saldos conferidos não distinguem saldo do dia, fechamento e saldo anterior, o que gera pendência falsa na auditoria.",
      efeito: "Classificar cada saldo pelo tipo. Nenhum valor de saldo é alterado.",
      exigeConfirmacaoHumana: false,
    });
  }

  for (const lin of input.lineages) {
    // Duplicata sem alvo concreto = movimento legítimo descartado pela regra antiga.
    const perdidos = lin.rows.filter(
      (r) => r.finalStatus === "SKIPPED_DUPLICATE" && !r.matchedAgainst,
    );
    const ausentes = lin.missingFromLedger.filter((r) => r.finalStatus !== "SKIPPED_DUPLICATE");
    const alvo = [...perdidos, ...ausentes];
    if (alvo.length) {
      acoes.push({
        kind: "REVIEW_LOST_MOVEMENT",
        severity: "CRITICO",
        importId: lin.importId,
        nomeArquivo: lin.nomeArquivo,
        targetIds: alvo.map((r) => r.itemId),
        quantidade: alvo.length,
        valorEnvolvido: alvo.reduce((acc, r) => acc + Math.abs(r.amount), 0),
        motivo:
          "O documento traz estes lançamentos, mas eles não têm movimento correspondente no extrato do sistema.",
        efeito:
          "Registrar novamente cada lançamento com a data e o valor originais do documento, após conferência de quem opera.",
        exigeConfirmacaoHumana: true,
      });
    }

    const transferenciasFracas = lin.rows.filter(
      (r) => r.reviewAction === "MATCH_TRANSFER" && r.reconciliationStatus === "POSSIBLE_MATCH",
    );
    if (transferenciasFracas.length) {
      acoes.push({
        kind: "REVIEW_UNPROVEN_TRANSFER",
        severity: "ATENCAO",
        importId: lin.importId,
        nomeArquivo: lin.nomeArquivo,
        targetIds: transferenciasFracas.map((r) => r.itemId),
        quantidade: transferenciasFracas.length,
        valorEnvolvido: transferenciasFracas.reduce((acc, r) => acc + Math.abs(r.amount), 0),
        motivo:
          "Estes lançamentos viraram transferência a partir de uma sugestão, sem movimento oposto comprovado em outra conta.",
        efeito:
          "Rever cada caso: manter como movimento da conta ou confirmar a transferência apontando a conta de destino real.",
        exigeConfirmacaoHumana: true,
      });
    }
  }

  const financeiros = acoes.filter((a) => a.exigeConfirmacaoHumana);
  return {
    geradoEm: new Date().toISOString(),
    dryRun: true,
    acoes,
    resumo: {
      total: acoes.length,
      metadados: acoes.length - financeiros.length,
      financeiros: financeiros.length,
      valorEnvolvido: financeiros.reduce((acc, a) => acc + a.valorEnvolvido, 0),
    },
  };
}
