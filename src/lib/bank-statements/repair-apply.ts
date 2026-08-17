/**
 * EXECUÇÃO CONTROLADA DO REPARO DA PERSISTÊNCIA.
 *
 * Só existe um caminho para gravar: o dry run passou, o candidato continua
 * ausente e a pré-condição é reconferida no banco no instante do clique.
 * Depois da gravação, o encadeamento mês a mês é recalculado com dados
 * frescos; se não fechar em zero, a transação criada é revertida.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  fetchBankBalanceCheckpoints,
  fetchBankStatementImports,
  fetchBankStatementItemsByAccount,
} from "@/lib/bank-statements/data";
import { fetchTransactions } from "@/lib/transactions";
import { buildAccountLineage } from "@/lib/bank-statements/lineage";
import { buildPersistenceRepairPlan } from "@/lib/bank-statements/persistence-repair";
import { buildChainedValidation, type ChainedPeriod } from "@/lib/bank-statements/chained-validation";
import type { RepairValidation, ValidatedCandidate } from "@/lib/bank-statements/repair-validation";

export type RepairGate = {
  habilitado: boolean;
  motivos: string[];
  candidato: ValidatedCandidate | null;
};

/** O botão "Aplicar reparo" só liga quando todas estas condições valem. */
export function evaluateRepairGate(v: RepairValidation | null): RepairGate {
  if (!v) return { habilitado: false, motivos: ["Rode o dry run de validação primeiro."], candidato: null };

  const motivos: string[] = [];
  if (v.validationRepair !== "PASS") motivos.push("VALIDATION_REPAIR não está em PASS.");
  if (v.totais.restoreCount !== 1) motivos.push(`restoreCount = ${v.totais.restoreCount} (precisa ser 1).`);
  if (v.totais.naoSeriamRestauradas !== 0)
    motivos.push(`${v.totais.naoSeriamRestauradas} linha(s) seriam descartadas.`);
  if (v.totais.mesesAindaDivergentes !== 0)
    motivos.push(`${v.totais.mesesAindaDivergentes} mês(es) continuariam divergentes.`);

  const candidato = v.candidatos.find((c) => c.veredito === "SERIA_RESTAURADA") ?? null;
  if (!candidato) motivos.push("Nenhum candidato apto à restauração.");
  else {
    const p = candidato.preview;
    if (!candidato.sourceId) motivos.push("Candidato sem sourceId.");
    if (!candidato.itemId) motivos.push("Candidato sem item de extrato.");
    if (!p.data_movimento) motivos.push("Candidato sem data contábil.");
    if (!(p.valor > 0)) motivos.push("Candidato sem valor.");
  }

  return { habilitado: motivos.length === 0, motivos, candidato };
}

export type RepairOutcome = {
  status:
    | "REPAIR_APPLIED"
    | "ALREADY_REPAIRED"
    | "REPAIR_PRECONDITION_FAILED"
    | "REPAIR_POST_VALIDATION_FAILED";
  mensagem: string;
  transactionId: string | null;
  logId: string | null;
  sourceId: string;
  periodos: ChainedPeriod[];
  diferencaResidual: number | null;
};

type RpcResult = {
  status: string;
  transaction_id?: string;
  log_id?: string;
  motivo?: string;
};

/** Executa o reparo: pré-condição no banco → 1 transaction → pós-validação encadeada. */
export async function applyPersistenceRepair(input: {
  accountId: string;
  familyId: string;
  candidato: ValidatedCandidate;
}): Promise<RepairOutcome> {
  const { candidato, accountId, familyId } = input;
  const p = candidato.preview;

  const { data, error } = await supabase.rpc("apply_bank_persistence_repair", {
    _item_id: candidato.itemId,
    _source_id: candidato.sourceId,
    _data: p.data_movimento as string,
    _valor: p.valor,
    _direcao: p.tipo === "ENTRADA" ? "IN" : "OUT",
    _descricao: p.descricao,
    _occurrence_index: p.occurrence_index,
  });
  if (error) throw error;
  const res = data as unknown as RpcResult;

  if (res.status === "ALREADY_REPAIRED") {
    return {
      status: "ALREADY_REPAIRED",
      mensagem: "Este movimento já havia sido restaurado — nada foi criado de novo.",
      transactionId: res.transaction_id ?? null,
      logId: null,
      sourceId: candidato.sourceId,
      periodos: [],
      diferencaResidual: null,
    };
  }

  if (res.status !== "REPAIRED") {
    return {
      status: "REPAIR_PRECONDITION_FAILED",
      mensagem:
        res.motivo ??
        (res.status === "EQUIVALENT_EXISTS"
          ? "Já existe uma movimentação equivalente no extrato — restaurar duplicaria dinheiro."
          : `Pré-condição falhou (${res.status}). Nada foi gravado.`),
      transactionId: res.transaction_id ?? null,
      logId: null,
      sourceId: candidato.sourceId,
      periodos: [],
      diferencaResidual: null,
    };
  }

  const transactionId = res.transaction_id ?? null;
  const logId = res.log_id ?? null;

  // ---- pós-validação com dados frescos ---------------------------------
  const chained = await rebuildChained({ accountId, familyId });
  const comDocumento = chained.periodos.filter((x) => x.saldoDocumento !== null);
  const fecha = comDocumento.length > 0 && comDocumento.every((x) => x.confereAntes === true);

  if (!fecha) {
    if (logId) {
      await supabase.rpc("revert_bank_persistence_repair", {
        _log_id: logId,
        _motivo: "Pós-validação não fechou em zero",
      });
    }
    return {
      status: "REPAIR_POST_VALIDATION_FAILED",
      mensagem:
        "A conferência depois da gravação não fechou em zero — a transação criada foi revertida automaticamente.",
      transactionId,
      logId,
      sourceId: candidato.sourceId,
      periodos: chained.periodos,
      diferencaResidual: chained.diferencaResidual,
    };
  }

  return {
    status: "REPAIR_APPLIED",
    mensagem: "Reparo aplicado: uma única movimentação foi restaurada e todos os meses fecham em zero.",
    transactionId,
    logId,
    sourceId: candidato.sourceId,
    periodos: chained.periodos,
    diferencaResidual: chained.diferencaResidual,
  };
}

async function rebuildChained(input: { accountId: string; familyId: string }) {
  const [transactions, imports, items, checkpoints] = await Promise.all([
    fetchTransactions(input.familyId),
    fetchBankStatementImports(input.accountId),
    fetchBankStatementItemsByAccount(input.accountId),
    fetchBankBalanceCheckpoints(input.accountId),
  ]);
  const daConta = transactions.filter((t) => t.bank_account_id === input.accountId);
  const lineages = buildAccountLineage({ imports, items, transactions: daConta, checkpoints });
  const plan = buildPersistenceRepairPlan({
    accountId: input.accountId,
    lineages,
    imports,
    items,
    transactions,
    allTransactions: transactions,
    checkpoints,
  });
  return buildChainedValidation(plan);
}
