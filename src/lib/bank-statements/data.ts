import { supabase } from "@/integrations/supabase/client";
import type { ParsedBankMovement, ParsedBankStatement } from "./types";
import type { ReconcileSuggestion } from "./reconcile";

export type StatementDraftRow = ParsedBankMovement & {
  incluir: boolean;
  sugestao: ReconcileSuggestion;
};

/** Grava a importação e os lançamentos revisados. Nada vira movimentação aqui. */
export async function createBankStatementImport(input: {
  familyId: string;
  bankAccountId: string;
  memberId: string | null;
  nomeArquivo: string;
  formato: "PDF" | "CSV" | "OFX" | "IMAGEM";
  parser: string;
  createdBy: string | null;
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
        purchase_id_matched: l.sugestao.purchaseId ?? null,
        card_invoice_id_matched: l.sugestao.cardInvoiceId ?? null,
        transfer_account_id: l.sugestao.transferAccountId ?? null,
        incluir: l.incluir,
        ordem: i,
      })),
    );
    if (itensError) throw itensError;
  }

  return imp;
}

/** Transforma em movimentações apenas o que foi aprovado na revisão. */
export async function confirmBankStatementImport(importId: string) {
  const { data, error } = await supabase.rpc("confirm_bank_statement_import", {
    _import_id: importId,
  });
  if (error) throw error;
  return data as { criadas: number; ignoradas: number };
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

/** Descarta uma importação ainda não confirmada. */
export async function deleteBankStatementImport(importId: string) {
  const { error } = await supabase
    .from("bank_statement_imports")
    .delete()
    .eq("id", importId)
    .neq("status", "CONFIRMED");
  if (error) throw error;
}
