import { supabase } from "@/integrations/supabase/client";

export const BACKUP_VERSION = 1;
export const APP_VERSION = "familia-finance-ai/1.0";

/** Tabelas operacionais ligadas diretamente à família. */
const FAMILY_SCOPED_TABLES = [
  "family_members",
  "member_financial_profiles",
  "financial_profiles",
  "financial_settings",
  "incomes",
  "fixed_expenses",
  "budgets",
  "bank_accounts",
  "credit_cards",
  "card_invoices",
  "purchases",
  "expenses",
  "expense_installments",
  "recurring_expenses",
  "transactions",
  "card_statement_imports",
  "card_statement_items",
  "reconciliations",
  "monthly_snapshots",
  "monthly_closing_logs",
  "documents",
  "document_extractions",
  "purchase_imports",
  "demo_settings",
] as const;

export type FamilyBackup = {
  backupVersion: number;
  createdAt: string;
  familyId: string;
  familyName: string;
  appVersion: string;
  data: Record<string, unknown[]>;
};

export type BackupResult = {
  backup: FamilyBackup;
  totalRegistros: number;
  porTabela: { tabela: string; registros: number }[];
};

async function selectAll(table: string, column: string, values: string[] | string) {
  if (Array.isArray(values) && values.length === 0) return [];
  const query = supabase.from(table as never).select("*");
  const { data, error } = await (Array.isArray(values)
    ? query.in(column, values)
    : query.eq(column, values));
  if (error) throw new Error(`Falha ao exportar ${table}: ${error.message}`);
  return (data ?? []) as unknown[];
}

function ids(rows: unknown[]) {
  return rows.map((r) => (r as { id: string }).id).filter(Boolean);
}

/**
 * Exporta apenas os dados da família informada. Nunca inclui credenciais,
 * tokens, usuários de autenticação ou registros de outras famílias.
 */
export async function generateFamilyBackup(familyId: string): Promise<BackupResult> {
  const { data: family, error } = await supabase
    .from("families")
    .select("*")
    .eq("id", familyId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!family) throw new Error("Família não encontrada.");

  const data: Record<string, unknown[]> = { families: [family] };

  for (const table of FAMILY_SCOPED_TABLES) {
    data[table] = await selectAll(table, "family_id", familyId);
  }

  // Tabelas-filhas, ligadas por um registro pai já restrito à família.
  data["purchase_items"] = await selectAll(
    "purchase_items",
    "purchase_id",
    ids(data["purchases"] ?? []),
  );
  data["document_extraction_items"] = await selectAll(
    "document_extraction_items",
    "extraction_id",
    ids(data["document_extractions"] ?? []),
  );
  data["purchase_import_items"] = await selectAll(
    "purchase_import_items",
    "purchase_import_id",
    ids(data["purchase_imports"] ?? []),
  );

  const porTabela = Object.entries(data)
    .map(([tabela, rows]) => ({ tabela, registros: rows.length }))
    .sort((a, b) => b.registros - a.registros);

  return {
    backup: {
      backupVersion: BACKUP_VERSION,
      createdAt: new Date().toISOString(),
      familyId,
      familyName: (family as { nome_da_familia: string }).nome_da_familia,
      appVersion: APP_VERSION,
      data,
    },
    totalRegistros: porTabela.reduce((acc, t) => acc + t.registros, 0),
    porTabela,
  };
}

export function backupFileName(date = new Date()) {
  return `familia-finance-backup-${date.toISOString().slice(0, 10)}.json`;
}

export function downloadBackup(backup: FamilyBackup) {
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = backupFileName(new Date(backup.createdAt));
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export type ResetType = "FINANCEIRO" | "FAMILIA_COMPLETA";

/** Execução server-side: a função valida internamente auth + permissão de ADMIN. */
export async function resetFamilyData(input: {
  familyId: string;
  tipo: ResetType;
  backupCreated: boolean;
  removerDemo?: boolean;
}) {
  if (input.tipo === "FAMILIA_COMPLETA") {
    const { data, error } = await supabase.rpc("reset_family_completely", {
      _family_id: input.familyId,
      _backup_created: input.backupCreated,
    });
    if (error) throw new Error(error.message);
    return data as Record<string, number>;
  }
  const { data, error } = await supabase.rpc("reset_family_financial_data", {
    _family_id: input.familyId,
    _backup_created: input.backupCreated,
    _remover_demo: input.removerDemo ?? false,
  });
  if (error) throw new Error(error.message);
  return data as Record<string, number>;
}

export type PurchasesCardsResetReport = {
  compras: number;
  compras_manuais: number;
  itens: number;
  parcelas: number;
  recorrencias: number;
  faturas_importadas: number;
  lancamentos_fatura: number;
  faturas: number;
  reconciliacoes: number;
  documentos: number;
  cartoes: number;
  transacoes_preservadas: number;
};

/** Relatório prévio do reset seletivo de Compras e Cartões. */
export async function inspectPurchasesCardsReset(familyId: string, incluirManuais: boolean) {
  const { data, error } = await supabase.rpc("inspect_family_purchases_cards_reset", {
    p_family_id: familyId,
    p_incluir_manuais: incluirManuais,
  });
  if (error) throw new Error(error.message);
  return data as unknown as PurchasesCardsResetReport;
}

/** Reset seletivo: limpa Compras e o histórico dos cartões, preservando o resto. */
export async function resetPurchasesAndCards(input: {
  familyId: string;
  incluirManuais: boolean;
  excluirCartoes: boolean;
  backupCreated: boolean;
}) {
  const { data, error } = await supabase.rpc("reset_family_purchases_and_cards", {
    p_family_id: input.familyId,
    p_incluir_manuais: input.incluirManuais,
    p_delete_cards: input.excluirCartoes,
    p_backup_created: input.backupCreated,
  });
  if (error) throw new Error(error.message);
  return data as unknown as Record<string, number>;
}

/** Contagens exibidas na confirmação forte, antes de excluir qualquer coisa. */
export async function countFamilyData(familyId: string) {
  const tabelas = [
    ["Compras", "purchases"],
    ["Transações", "transactions"],
    ["Contas bancárias", "bank_accounts"],
    ["Cartões", "credit_cards"],
    ["Faturas", "card_invoices"],
    ["Parcelamentos", "expense_installments"],
    ["Recorrências", "recurring_expenses"],
    ["Receitas", "incomes"],
    ["Importações de fatura", "card_statement_imports"],
    ["Documentos", "documents"],
    ["Fechamentos mensais", "monthly_snapshots"],
  ] as const;

  const linhas = await Promise.all(
    tabelas.map(async ([label, table]) => {
      const { count } = await supabase
        .from(table as never)
        .select("id", { count: "exact", head: true })
        .eq("family_id", familyId);
      return { label, total: count ?? 0 };
    }),
  );

  const { data: compras } = await supabase.from("purchases").select("id").eq("family_id", familyId);
  const purchaseIds = ids(compras ?? []);
  let itens = 0;
  if (purchaseIds.length > 0) {
    const { count } = await supabase
      .from("purchase_items")
      .select("id", { count: "exact", head: true })
      .in("purchase_id", purchaseIds);
    itens = count ?? 0;
  }

  return [...linhas, { label: "Itens de compra", total: itens }];
}
