/**
 * Leitura (SELECT apenas) dos dados necessários para o
 * CARD_STATEMENT_PERSISTENCE_DRY_RUN. Nenhuma escrita acontece aqui.
 */
import { supabase } from "@/integrations/supabase/client";
import {
  cardStatementPersistenceDryRun,
  type CardStatementPersistenceDryRun,
  type InvoiceCanonical,
  type OfficialItem,
} from "@/lib/card-statement-persistence";

function janela(inicio: string | null, fim: string | null) {
  const desloca = (iso: string | null, dias: number, fallback: string) => {
    if (!iso) return fallback;
    const d = new Date(`${iso}T00:00:00`);
    d.setDate(d.getDate() + dias);
    return d.toISOString().slice(0, 10);
  };
  return {
    de: desloca(inicio, -10, "1900-01-01"),
    ate: desloca(fim, 10, "2999-12-31"),
  };
}

export async function runCardStatementPersistenceDryRun(params: {
  familyId: string;
  invoice: InvoiceCanonical;
  items: OfficialItem[];
}): Promise<CardStatementPersistenceDryRun> {
  const { familyId, invoice, items } = params;
  const { de, ate } = janela(invoice.periodStart ?? null, invoice.periodEnd ?? invoice.closingDate);

  const [cards, imports, statementItems, purchases] = await Promise.all([
    supabase
      .from("credit_cards")
      .select("id, banco, nome_cartao, ativo, member_id")
      .eq("family_id", familyId),
    supabase
      .from("card_statement_imports")
      .select(
        "id, credit_card_id, fingerprint, data_fechamento, data_vencimento, valor_total_fatura, status, nome_arquivo",
      )
      .eq("family_id", familyId),
    supabase
      .from("card_statement_items")
      .select(
        "id, import_id, credit_card_id, data_lancamento, descricao_original, descricao_normalizada, valor, parcela_atual, total_parcelas, purchase_id_matched",
      )
      .eq("family_id", familyId)
      .gte("data_lancamento", de)
      .lte("data_lancamento", ate),
    supabase
      .from("purchases")
      .select("id, data_compra, valor_total, estabelecimento, credit_card_id")
      .eq("family_id", familyId)
      .gte("data_compra", de)
      .lte("data_compra", ate),
  ]);

  const erro = cards.error ?? imports.error ?? statementItems.error ?? purchases.error;
  if (erro) throw new Error(erro.message);

  return cardStatementPersistenceDryRun({
    invoice,
    items,
    cards: (cards.data ?? []).map((c) => ({ ...c, ativo: c.ativo ?? true })),
    imports: (imports.data ?? []).map((i) => ({
      ...i,
      valor_total_fatura: Number(i.valor_total_fatura ?? 0),
      status: String(i.status),
    })),
    statementItems: (statementItems.data ?? []).map((s) => ({
      ...s,
      valor: Number(s.valor ?? 0),
    })),
    purchases: (purchases.data ?? []).map((p) => ({
      ...p,
      valor_total: Number(p.valor_total ?? 0),
    })),
  });
}
