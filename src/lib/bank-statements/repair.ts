/**
 * REPARO HISTÓRICO DO EXTRATO — operação auditável, sem ajustes financeiros.
 *
 * O que esta camada faz (e só isso):
 *   1. relê a importação já existente (não cria outra);
 *   2. recompõe o período do documento a partir dos lançamentos lidos;
 *   3. DESFAZ associações feitas com movimentações de outro mês — o vínculo é
 *      removido, a movimentação do outro mês continua intacta;
 *   4. recria apenas o que falta, checando antes se a movimentação já existe
 *      (mesma conta + data + valor + sentido) para nunca duplicar;
 *   5. devolve um relatório por mês.
 *
 * O que NUNCA acontece aqui: ajuste de saldo, exclusão de agosto, criação de
 * checkpoint inventado. Saldo do dia só nasce do PDF reenviado.
 */
import { supabase } from "@/integrations/supabase/client";

/** Tolerância de data para conciliação automática (dias). */
export const TOLERANCIA_MATCH_DIAS = 2;

export type ImportRepairStatus =
  | "VALIDADO"
  | "SOURCE_FILE_MISSING"
  | "CHECKPOINTS_AUSENTES"
  | "MOVIMENTOS_INCOMPLETOS"
  | "INVALID_MATCHES"
  | "DIVERGENCIA";

export const REPAIR_STATUS_LABELS: Record<ImportRepairStatus, string> = {
  VALIDADO: "Validado",
  SOURCE_FILE_MISSING: "PDF de origem ausente",
  CHECKPOINTS_AUSENTES: "Checkpoints ausentes",
  MOVIMENTOS_INCOMPLETOS: "Movimentos incompletos",
  INVALID_MATCHES: "Associações inválidas",
  DIVERGENCIA: "Divergência de saldo",
};

export const REPAIR_STATUS_TONES: Record<
  ImportRepairStatus,
  "ok" | "danger" | "warn" | "info" | "muted"
> = {
  VALIDADO: "ok",
  SOURCE_FILE_MISSING: "info",
  CHECKPOINTS_AUSENTES: "info",
  MOVIMENTOS_INCOMPLETOS: "danger",
  INVALID_MATCHES: "warn",
  DIVERGENCIA: "danger",
};

/** Relatório de reprocessamento de uma importação (um mês, na prática). */
export type ImportRepairReport = {
  importId: string;
  arquivo: string;
  mes: string | null;
  periodoInicio: string | null;
  periodoFim: string | null;
  movimentosPdf: number;
  ledgerAntes: number;
  ledgerDepois: number;
  associacoesInvalidasRemovidas: number;
  itensReabertos: number;
  criadas: number;
  associadas: number;
  ignoradas: number;
  checkpoints: number;
  saldoFinal: number | null;
  status: ImportRepairStatus;
};

type RawReport = {
  import_id: string;
  arquivo: string;
  mes: string | null;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  movimentos_pdf: number;
  ledger_antes: number;
  ledger_depois: number;
  associacoes_invalidas_removidas: number;
  itens_reabertos: number;
  criadas: number;
  associadas: number;
  ignoradas: number;
  checkpoints: number;
  saldo_final: number | string | null;
  status: string;
};

function normalizar(raw: RawReport): ImportRepairReport {
  const status = (
    ["VALIDADO", "SOURCE_FILE_MISSING", "MOVIMENTOS_INCOMPLETOS"].includes(raw.status)
      ? raw.status
      : "DIVERGENCIA"
  ) as ImportRepairStatus;
  return {
    importId: raw.import_id,
    arquivo: raw.arquivo,
    mes: raw.mes,
    periodoInicio: raw.periodo_inicio,
    periodoFim: raw.periodo_fim,
    movimentosPdf: Number(raw.movimentos_pdf ?? 0),
    ledgerAntes: Number(raw.ledger_antes ?? 0),
    ledgerDepois: Number(raw.ledger_depois ?? 0),
    associacoesInvalidasRemovidas: Number(raw.associacoes_invalidas_removidas ?? 0),
    itensReabertos: Number(raw.itens_reabertos ?? 0),
    criadas: Number(raw.criadas ?? 0),
    associadas: Number(raw.associadas ?? 0),
    ignoradas: Number(raw.ignoradas ?? 0),
    checkpoints: Number(raw.checkpoints ?? 0),
    saldoFinal: raw.saldo_final === null ? null : Number(raw.saldo_final),
    status,
  };
}

/** Reprocessa uma importação já existente. Idempotente: rodar de novo não duplica. */
export async function reprocessBankStatementImport(
  importId: string,
  tolerancia = TOLERANCIA_MATCH_DIAS,
): Promise<ImportRepairReport> {
  const { data, error } = await supabase.rpc("reprocess_bank_statement_import", {
    _import_id: importId,
    _tolerancia: tolerancia,
  });
  if (error) throw error;
  return normalizar(data as unknown as RawReport);
}

/** Reprocessa o histórico inteiro da conta, do mês mais antigo para o mais novo. */
export async function reprocessAccountHistory(input: {
  imports: { id: string; periodo_inicio: string | null; created_at: string }[];
  tolerancia?: number;
  onProgress?: (feito: number, total: number) => void;
}): Promise<ImportRepairReport[]> {
  const ordenados = [...input.imports].sort((a, b) =>
    String(a.periodo_inicio ?? a.created_at).localeCompare(String(b.periodo_inicio ?? b.created_at)),
  );
  const saidas: ImportRepairReport[] = [];
  for (let i = 0; i < ordenados.length; i++) {
    saidas.push(
      await reprocessBankStatementImport(ordenados[i]!.id, input.tolerancia ?? TOLERANCIA_MATCH_DIAS),
    );
    input.onProgress?.(i + 1, ordenados.length);
  }
  return saidas;
}

/**
 * Saldos de abertura repetidos: cada importação antiga criou um "saldo anterior"
 * próprio e todos se somaram. Mantém apenas o primeiro e cancela os demais —
 * nenhum ajuste é criado, o saldo passa a nascer só das movimentações.
 */
export async function normalizeOpeningBalances(accountId: string) {
  const { data, error } = await supabase.rpc("normalize_bank_opening_balances", {
    _account_id: accountId,
  });
  if (error) throw error;
  const raw = data as unknown as { canceladas: number; saldo: number | string };
  return { canceladas: Number(raw.canceladas ?? 0), saldo: Number(raw.saldo ?? 0) };
}
