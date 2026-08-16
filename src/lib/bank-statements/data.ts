import { supabase } from "@/integrations/supabase/client";
import type { ParsedBankMovement, ParsedBankStatement, ReviewAction } from "./types";
import { ACOES_SEM_EFEITO } from "./types";
import type { ReconcileSuggestion } from "./reconcile";
import { checkpointsInéditos } from "./dedupe";

export type StatementDraftRow = ParsedBankMovement & {
  incluir: boolean;
  acao: ReviewAction;
  sugestao: ReconcileSuggestion;
};

/** Impressão digital determinística do arquivo — evita importar o mesmo extrato duas vezes. */
export async function statementFingerprint(file: Blob) {
  const buffer = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buffer);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** Já existe uma importação com este mesmo arquivo nesta conta? */
export async function findExistingStatementImport(accountId: string, fingerprint: string) {
  const { data, error } = await supabase
    .from("bank_statement_imports")
    .select("*")
    .eq("bank_account_id", accountId)
    .eq("fingerprint", fingerprint)
    .order("created_at", { ascending: false })
    .limit(1);
  if (error) throw error;
  return data?.[0] ?? null;
}

/** Grava a importação e os lançamentos revisados. Nada vira movimentação aqui. */
export async function createBankStatementImport(input: {
  familyId: string;
  bankAccountId: string;
  memberId: string | null;
  nomeArquivo: string;
  formato: "PDF" | "CSV" | "OFX" | "IMAGEM";
  parser: string;
  createdBy: string | null;
  fingerprint: string | null;
  resumo: ParsedBankStatement;
  linhas: StatementDraftRow[];
}) {
  const entradas = input.linhas.filter((l) => l.valor > 0).reduce((a, l) => a + l.valor, 0);
  const saidas = input.linhas
    .filter((l) => l.valor < 0)
    .reduce((a, l) => a + Math.abs(l.valor), 0);

  const { data: imp, error } = await supabase
    .from("bank_statement_imports")
    .insert({
      family_id: input.familyId,
      bank_account_id: input.bankAccountId,
      member_id: input.memberId,
      nome_arquivo: input.nomeArquivo,
      formato: input.formato,
      parser: input.parser,
      fingerprint: input.fingerprint,
      periodo_inicio: input.resumo.periodoInicio,
      periodo_fim: input.resumo.periodoFim,
      saldo_inicial: input.resumo.saldoInicial,
      saldo_final: input.resumo.saldoFinal,
      total_entradas: entradas,
      total_saidas: saidas,
      quantidade_lancamentos: input.linhas.length,
      status: "READY_FOR_REVIEW",
      created_by: input.createdBy,
    })
    .select()
    .single();
  if (error) throw error;

  if (input.linhas.length) {
    const { error: itensError } = await supabase.from("bank_statement_items").insert(
      input.linhas.map((l, i) => ({
        import_id: imp.id,
        family_id: input.familyId,
        bank_account_id: input.bankAccountId,
        data_movimento: l.data,
        descricao_original: l.descricaoOriginal,
        descricao_normalizada: l.descricaoNormalizada || l.descricaoOriginal,
        valor: l.valor,
        tipo_sugerido: l.tipo,
        match_status: l.sugestao.matchStatus,
        confidence_score: l.sugestao.confidence,
        review_action: l.acao,
        purchase_id_matched: l.sugestao.purchaseId ?? null,
        card_invoice_id_matched: l.sugestao.cardInvoiceId ?? null,
        transfer_account_id: l.sugestao.transferAccountId ?? null,
        transaction_id_matched: l.sugestao.transactionId ?? null,
        income_id_matched: l.sugestao.incomeId ?? null,
        incluir: !ACOES_SEM_EFEITO.includes(l.acao),
        ordem: i,
      })),
    );
    if (itensError) throw itensError;
  }

  // Checkpoints de saldo: conferência do extrato, nunca movimentação.
  // Extratos sobrepostos: mesma conta + mesma data + mesmo saldo é reutilizado.
  const existentes = await fetchBankBalanceCheckpoints(input.bankAccountId);
  const checkpoints = checkpointsInéditos(input.resumo.checkpoints ?? [], existentes);
  if (checkpoints.length) {
    const { error: checkError } = await supabase.from("bank_balance_checkpoints").insert(
      checkpoints.map((c) => ({
        family_id: input.familyId,
        bank_account_id: input.bankAccountId,
        member_id: input.memberId,
        import_id: imp.id,
        data: c.data,
        saldo_informado: c.saldo,
        origem: "EXTRATO_IMPORTADO",
        rotulo: c.rotulo ?? null,
        created_by: input.createdBy,
      })),
    );
    if (checkError) throw checkError;
  }

  return imp;
}

/** Saldos diários informados pelo banco, usados só para conferência. */
export async function fetchBankBalanceCheckpoints(accountId: string) {
  const { data, error } = await supabase
    .from("bank_balance_checkpoints")
    .select("*")
    .eq("bank_account_id", accountId)
    .order("data", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((c) => ({
    data: c.data as string,
    saldo: Number(c.saldo_informado),
    rotulo: c.rotulo as string | null,
  }));
}


/** Executa as ações revisadas. Idempotente: confirmar de novo não duplica nada. */
export async function confirmBankStatementImport(importId: string) {
  const { data, error } = await supabase.rpc("confirm_bank_statement_import", {
    _import_id: importId,
  });
  if (error) throw error;
  return data as unknown as { criadas: number; associadas: number; ignoradas: number };
}

export async function fetchBankStatementImports(accountId: string) {
  const { data, error } = await supabase
    .from("bank_statement_imports")
    .select("*")
    .eq("bank_account_id", accountId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

/** Lançamentos lidos dos extratos da conta — evidência do PDF para auditoria. */
export async function fetchBankStatementItemsByAccount(accountId: string) {
  const { data, error } = await supabase
    .from("bank_statement_items")
    .select(
      "id, import_id, data_movimento, descricao_original, valor, tipo_sugerido, incluir, review_action, match_status, transaction_id_criada, transaction_id_matched, purchase_id_criada, purchase_id_matched, ordem",
    )
    .eq("bank_account_id", accountId)
    .order("data_movimento", { ascending: true })
    .order("ordem", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export type BankStatementItemRow = Awaited<
  ReturnType<typeof fetchBankStatementItemsByAccount>
>[number];

/** Descarta uma importação ainda não confirmada. */
export async function deleteBankStatementImport(importId: string) {
  const { error } = await supabase
    .from("bank_statement_imports")
    .delete()
    .eq("id", importId)
    .neq("status", "CONFIRMED");
  if (error) throw error;
}
