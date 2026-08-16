/**
 * Importar e conferir — fatura de cartão em PDF.
 *
 * Este módulo NÃO altera o motor financeiro existente:
 * ele apenas lê a fatura, compara com o que já existe (compras, parcelas e
 * recorrências) e guarda tudo como dado temporário até a confirmação humana.
 * Só na confirmação, e apenas para o que o usuário aprovou, uma compra é criada
 * usando exatamente o mesmo caminho oficial (`createPurchase`).
 */
import { supabase } from "@/integrations/supabase/client";
import type { Database } from "@/integrations/supabase/types";
import { createPurchase, type NewPurchaseItem } from "@/lib/purchases";
import { suggestCategoryId } from "@/lib/category-suggest";
import type { CreditCard } from "@/lib/finance";
import { normalizeDescricao, type ParsedStatement, type StatementEntry } from "@/lib/card-statement-parsers";
import type { Tone } from "@/lib/status";

export type StatementImport = Database["public"]["Tables"]["card_statement_imports"]["Row"];
export type StatementItem = Database["public"]["Tables"]["card_statement_items"]["Row"];
export type MatchStatus = Database["public"]["Enums"]["statement_match_status"];
export type ItemKind = Database["public"]["Enums"]["statement_item_kind"];
export type ImportStatus = Database["public"]["Enums"]["card_statement_status"];
export type ItemAction = Database["public"]["Enums"]["statement_item_action"];

export const NAO_IDENTIFICADO = "Não identificado";

export const MATCH_LABELS: Record<MatchStatus, string> = {
  MATCHED: "Conciliado",
  UNMATCHED: "Novo lançamento",
  POSSIBLE_MATCH: "Possível correspondência",
  DIVERGENT: "Divergente",
  IGNORED: "Ignorado",
  CONFIRMED_NEW: "Novo confirmado",
};

export const MATCH_TONES: Record<MatchStatus, Tone> = {
  MATCHED: "ok",
  UNMATCHED: "info",
  POSSIBLE_MATCH: "warn",
  DIVERGENT: "danger",
  IGNORED: "muted",
  CONFIRMED_NEW: "ok",
};

export const KIND_LABELS: Record<ItemKind, string> = {
  COMPRA: "Compra",
  PAGAMENTO: "Pagamento",
  ESTORNO: "Estorno",
  JUROS: "Juros",
  TAXA: "Taxa",
  AJUSTE: "Ajuste",
  OUTRO: "Outro",
};

export const IMPORT_STATUS_LABELS: Record<ImportStatus, string> = {
  UPLOADED: "Enviada",
  PROCESSING: "Lendo o PDF",
  READY_FOR_REVIEW: "Aguardando revisão",
  CONFIRMED: "Revisão confirmada",
  CANCELLED: "Cancelada",
  ERROR: "Erro na leitura",
};

export const ACTION_LABELS: Record<ItemAction, string> = {
  PENDENTE: "Pendente",
  PROCESSANDO: "Processando",
  CONCLUIDO: "Concluído",
  ERRO: "Erro",
};

/** Decisões possíveis para um lançamento divergente. */
export type DecisaoDivergencia = "USAR_VALOR_FATURA" | "MANTER_VALOR" | "CRIAR_NOVO";

// ------------------------------------------------------------------ utilidades

export function formatOptional(value: string | null | undefined) {
  return value && value.trim() ? value : NAO_IDENTIFICADO;
}

/** Impressão digital da fatura, para detectar importação repetida. */
export function statementFingerprint(input: {
  cardId: string;
  vencimento: string | null;
  total: number | null;
  periodoInicio: string | null;
  quantidade: number;
}) {
  const base = [
    input.cardId,
    input.vencimento ?? "",
    (input.total ?? 0).toFixed(2),
    input.periodoInicio ?? "",
    String(input.quantidade),
  ].join("|");
  let hash = 5381;
  for (let i = 0; i < base.length; i++) hash = (hash * 33) ^ base.charCodeAt(i);
  return `${(hash >>> 0).toString(16)}-${input.cardId.slice(0, 8)}`;
}

function tokens(texto: string) {
  return normalizeDescricao(texto)
    .split(" ")
    .filter((t) => t.length > 2);
}

/** Similaridade de descrições entre 0 e 1 (coeficiente de Dice por tokens). */
export function similaridade(a: string, b: string) {
  const ta = tokens(a);
  const tb = tokens(b);
  if (ta.length === 0 || tb.length === 0) return 0;
  const setB = new Set(tb);
  const comuns = ta.filter((t) => setB.has(t)).length;
  return (2 * comuns) / (ta.length + tb.length);
}

export function diasEntre(a: string | null, b: string | null) {
  if (!a || !b) return 999;
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(Math.round((da - db) / 86_400_000));
}

const centavos = (v: number) => Math.round(Math.abs(v) * 100);

// ------------------------------------------------------------------ motor de correspondência

type Candidatos = {
  purchases: Database["public"]["Tables"]["purchases"]["Row"][];
  installments: Database["public"]["Tables"]["expense_installments"]["Row"][];
  recurring: Database["public"]["Tables"]["recurring_expenses"]["Row"][];
};

export type MatchResult = {
  match_status: MatchStatus;
  confidence_score: number | null;
  purchase_id_matched: string | null;
  installment_id_matched: string | null;
  recurring_expense_id_matched: string | null;
  diferenca: number | null;
};

/** Busca no banco tudo que pode corresponder aos lançamentos desta fatura. */
export async function fetchMatchCandidates(input: {
  familyId: string;
  cardId: string;
  inicio: string | null;
  fim: string | null;
}): Promise<Candidatos> {
  const inicio = input.inicio ?? "1900-01-01";
  const fim = input.fim ?? "2999-12-31";

  const [{ data: purchases }, { data: installments }, { data: recurring }] = await Promise.all([
    supabase
      .from("purchases")
      .select("*")
      .eq("family_id", input.familyId)
      .eq("credit_card_id", input.cardId)
      .gte("data_compra", inicio)
      .lte("data_compra", fim),
    supabase
      .from("expense_installments")
      .select("*")
      .eq("family_id", input.familyId)
      .eq("credit_card_id", input.cardId),
    supabase
      .from("recurring_expenses")
      .select("*")
      .eq("family_id", input.familyId)
      .eq("credit_card_id", input.cardId),
  ]);

  return {
    purchases: purchases ?? [],
    installments: installments ?? [],
    recurring: recurring ?? [],
  };
}

/**
 * Classifica um lançamento da fatura contra o que já existe no sistema.
 * Em caso de dúvida, nunca confirma sozinho: devolve POSSIBLE_MATCH.
 */
export function matchEntry(
  entry: StatementEntry,
  candidatos: Candidatos,
  usados: Set<string>,
): MatchResult {
  const vazio: MatchResult = {
    match_status: "UNMATCHED",
    confidence_score: null,
    purchase_id_matched: null,
    installment_id_matched: null,
    recurring_expense_id_matched: null,
    diferenca: null,
  };

  // Lançamentos que não são consumo não viram compra: ficam ignorados por padrão.
  if (entry.tipo_sugerido !== "COMPRA") {
    return { ...vazio, match_status: "IGNORED" };
  }

  const valor = centavos(entry.valor);

  // 1) Parcelamento já existente: a fatura traz "03/12".
  if (entry.parcela_atual && entry.total_parcelas) {
    const parcelas = candidatos.installments.filter(
      (p) =>
        p.numero_parcela === entry.parcela_atual &&
        p.total_parcelas === entry.total_parcelas &&
        !usados.has(`inst:${p.id}`),
    );
    const exata = parcelas.find((p) => centavos(Number(p.valor_parcela)) === valor);
    if (exata) {
      usados.add(`inst:${exata.id}`);
      return {
        ...vazio,
        match_status: "MATCHED",
        confidence_score: 0.95,
        installment_id_matched: exata.id,
        purchase_id_matched: exata.purchase_id,
      };
    }
    if (parcelas.length === 1) {
      const p = parcelas[0]!;
      usados.add(`inst:${p.id}`);
      return {
        ...vazio,
        match_status: "DIVERGENT",
        confidence_score: 0.7,
        installment_id_matched: p.id,
        purchase_id_matched: p.purchase_id,
        diferenca: Math.abs(entry.valor) - Number(p.valor_parcela),
      };
    }
  }

  // 2) Compra avulsa já registrada no cartão.
  const comparaveis = candidatos.purchases
    .filter((p) => !usados.has(`pur:${p.id}`))
    .map((p) => ({
      p,
      sim: similaridade(entry.descricao_original, p.estabelecimento),
      dias: diasEntre(entry.data_lancamento, p.data_compra),
      igual: centavos(Number(p.valor_total)) === valor,
    }))
    .sort((a, b) => b.sim - a.sim || a.dias - b.dias);

  const forte = comparaveis.find((c) => c.igual && c.sim >= 0.7 && c.dias <= 1);
  if (forte) {
    usados.add(`pur:${forte.p.id}`);
    return {
      ...vazio,
      match_status: "MATCHED",
      confidence_score: 0.9,
      purchase_id_matched: forte.p.id,
    };
  }

  const provavel = comparaveis.find((c) => c.igual && c.dias <= 5 && c.sim >= 0.4);
  if (provavel) {
    usados.add(`pur:${provavel.p.id}`);
    return {
      ...vazio,
      match_status: "POSSIBLE_MATCH",
      confidence_score: 0.6,
      purchase_id_matched: provavel.p.id,
    };
  }

  const divergente = comparaveis.find(
    (c) => !c.igual && c.sim >= 0.7 && c.dias <= 5 && Math.abs(Number(c.p.valor_total)) > 0,
  );
  if (divergente) {
    usados.add(`pur:${divergente.p.id}`);
    return {
      ...vazio,
      match_status: "DIVERGENT",
      confidence_score: 0.55,
      purchase_id_matched: divergente.p.id,
      diferenca: Math.abs(entry.valor) - Number(divergente.p.valor_total),
    };
  }

  // 3) Recorrência ativa no mesmo cartão (Netflix, Google One...).
  const recorrentes = candidatos.recurring
    .filter((r) => centavos(Number(r.valor)) === valor)
    .map((r) => ({ r, sim: similaridade(entry.descricao_original, r.nome) }))
    .filter((c) => c.sim >= 0.4)
    .sort((a, b) => b.sim - a.sim);

  if (recorrentes.length === 1) {
    return {
      ...vazio,
      match_status: "POSSIBLE_MATCH",
      confidence_score: 0.65,
      recurring_expense_id_matched: recorrentes[0]!.r.id,
    };
  }
  if (recorrentes.length > 1) {
    // Mais de uma recorrência com o mesmo valor: nunca escolher sozinho.
    return { ...vazio, match_status: "POSSIBLE_MATCH", confidence_score: 0.4 };
  }

  return vazio;
}

// ------------------------------------------------------------------ persistência

export async function findDuplicateImport(familyId: string, fingerprint: string) {
  const { data, error } = await supabase
    .from("card_statement_imports")
    .select("*")
    .eq("family_id", familyId)
    .eq("fingerprint", fingerprint)
    .neq("status", "CANCELLED")
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchStatementImports(familyId: string) {
  const { data, error } = await supabase
    .from("card_statement_imports")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (error) throw error;
  return data ?? [];
}

export async function fetchStatementImport(id: string) {
  const { data, error } = await supabase
    .from("card_statement_imports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (error) throw error;
  return data;
}

export async function fetchStatementItems(importId: string) {
  const { data, error } = await supabase
    .from("card_statement_items")
    .select("*")
    .eq("import_id", importId)
    .order("ordem", { ascending: true });
  if (error) throw error;
  return data ?? [];
}

export async function updateStatementItem(id: string, patch: Partial<StatementItem>) {
  const { error } = await supabase.from("card_statement_items").update(patch).eq("id", id);
  if (error) throw error;
}

export async function cancelStatementImport(id: string) {
  const { error } = await supabase
    .from("card_statement_imports")
    .update({ status: "CANCELLED" })
    .eq("id", id);
  if (error) throw error;
}

/**
 * Lê o PDF, cria a importação temporária e grava os lançamentos já comparados
 * com o que existe no sistema. Nenhum dado financeiro é criado aqui.
 */
export async function processStatementPdf(input: {
  familyId: string;
  memberId: string | null;
  createdBy: string | null;
  card: Pick<CreditCard, "id" | "banco" | "nome_cartao">;
  file: File;
  parsed: ParsedStatement;
  categorias: { id: string; nome: string }[];
}) {
  const { parsed } = input;
  const totalExtraido = parsed.entries.reduce((acc, e) => acc + e.valor, 0);
  const fingerprint = statementFingerprint({
    cardId: input.card.id,
    vencimento: parsed.data_vencimento,
    total: parsed.valor_total_fatura,
    periodoInicio: parsed.periodo_inicio,
    quantidade: parsed.entries.length,
  });

  const { data: importacao, error } = await supabase
    .from("card_statement_imports")
    .insert({
      family_id: input.familyId,
      member_id: input.memberId,
      credit_card_id: input.card.id,
      created_by: input.createdBy,
      nome_arquivo: input.file.name || "fatura.pdf",
      emissor: parsed.emissor,
      titular: parsed.titular,
      final_cartao: parsed.final_cartao,
      periodo_inicio: parsed.periodo_inicio,
      periodo_fim: parsed.periodo_fim,
      data_fechamento: parsed.data_fechamento,
      data_vencimento: parsed.data_vencimento,
      valor_total_fatura: parsed.valor_total_fatura ?? 0,
      total_extraido: totalExtraido,
      quantidade_lancamentos: parsed.entries.length,
      parser: parsed.parser,
      fingerprint,
      status: "PROCESSING",
      dados_brutos_json: { linhas: parsed.linhas.slice(0, 400), arquivo: input.file.name },
    })
    .select()
    .single();
  if (error) throw error;

  try {
    // A janela de busca considera o período da fatura E as datas dos lançamentos
    // (compras podem ter data fora do ciclo informado no cabeçalho), com folga de 10 dias.
    const datas = parsed.entries.map((e) => e.data_lancamento).filter(Boolean) as string[];
    const desloca = (data: string, dias: number) => {
      const d = new Date(`${data}T12:00:00`);
      d.setDate(d.getDate() + dias);
      return d.toISOString().slice(0, 10);
    };
    const limites = [parsed.periodo_inicio, parsed.periodo_fim, ...datas].filter(Boolean) as string[];
    const candidatos = await fetchMatchCandidates({
      familyId: input.familyId,
      cardId: input.card.id,
      inicio: limites.length ? desloca(limites.slice().sort()[0]!, -10) : null,
      fim: limites.length ? desloca(limites.slice().sort().at(-1)!, 10) : null,
    });

    const usados = new Set<string>();

    const rows = parsed.entries.map((entry, index) => {
      const resultado = matchEntry(entry, candidatos, usados);
      return {
        import_id: importacao.id,
        family_id: input.familyId,
        credit_card_id: input.card.id,
        data_lancamento: entry.data_lancamento,
        descricao_original: entry.descricao_original,
        descricao_normalizada: entry.descricao_normalizada,
        estabelecimento_sugerido: entry.estabelecimento_sugerido,
        valor: entry.valor,
        parcela_atual: entry.parcela_atual,
        total_parcelas: entry.total_parcelas,
        tipo_sugerido: entry.tipo_sugerido,
        categoria_sugerida_id:
          entry.tipo_sugerido === "COMPRA"
            ? suggestCategoryId(entry.descricao_original, input.categorias)
            : null,
        ordem: index,
        ...resultado,
      };
    });

    if (rows.length > 0) {
      const { error: itemsError } = await supabase.from("card_statement_items").insert(rows);
      if (itemsError) throw itemsError;
    }

    await supabase
      .from("card_statement_imports")
      .update({ status: "READY_FOR_REVIEW" })
      .eq("id", importacao.id);

    return { ...importacao, status: "READY_FOR_REVIEW" as ImportStatus };
  } catch (e) {
    await supabase
      .from("card_statement_imports")
      .update({
        status: "ERROR",
        erro_mensagem: e instanceof Error ? e.message : "Falha ao comparar os lançamentos.",
      })
      .eq("id", importacao.id);
    throw e;
  }
}

// ------------------------------------------------------------------ confirmação

async function registrarConciliacao(input: {
  familyId: string;
  itemId: string;
  targetType: "purchase" | "expense_installment" | "recurring_expense";
  targetId: string;
  confidence: number | null;
  userId: string | null;
}) {
  const { error } = await supabase.from("reconciliations").insert({
    family_id: input.familyId,
    source_type: "card_statement_item",
    source_id: input.itemId,
    target_type: input.targetType,
    target_id: input.targetId,
    status: "CONFIRMADA",
    confidence_score: input.confidence,
    reconciled_by: input.userId,
  });
  if (error) throw error;
}

async function registrarAuditoria(input: {
  familyId: string;
  entidadeId: string;
  valorAnterior: number;
  valorNovo: number;
  userId: string | null;
}) {
  await supabase.from("reconciliation_audit").insert({
    family_id: input.familyId,
    entidade: "purchase",
    entidade_id: input.entidadeId,
    campo: "valor_total",
    valor_anterior: input.valorAnterior.toFixed(2),
    valor_novo: input.valorNovo.toFixed(2),
    origem: "IMPORTACAO_FATURA",
    created_by: input.userId,
  });
}

export type ConfirmResult = {
  conciliados: number;
  criados: number;
  ignorados: number;
  atualizados: number;
  erros: { item: string; mensagem: string }[];
};

/**
 * Executa apenas as decisões aprovadas pelo usuário, item por item,
 * com status explícito em cada lançamento. Nunca mascara falha parcial
 * e nunca reprocessa um item já concluído.
 */
export async function confirmStatementImport(input: {
  importacao: StatementImport;
  items: StatementItem[];
  card: CreditCard;
  memberId: string | null;
  userId: string | null;
}): Promise<ConfirmResult> {
  const { importacao, card } = input;
  if (importacao.status === "CONFIRMED") {
    throw new Error("Esta fatura já foi confirmada.");
  }

  const resultado: ConfirmResult = {
    conciliados: 0,
    criados: 0,
    ignorados: 0,
    atualizados: 0,
    erros: [],
  };

  for (const item of input.items) {
    if (item.user_action === "CONCLUIDO") continue;
    await updateStatementItem(item.id, { user_action: "PROCESSANDO", erro_mensagem: null });

    try {
      const valor = Math.abs(Number(item.valor) || 0);
      const criarCompra = async (valorFinal: number) => {
        const itens: NewPurchaseItem[] = [
          {
            product_id: "",
            descricao_produto: item.estabelecimento_sugerido || item.descricao_original,
            quantidade: "1",
            unidade: "UN",
            valor_unitario: String(valorFinal),
            categoria_id: item.categoria_sugerida_id ?? "",
            ...(item.categoria_sugerida_id ? { categoria_sugerida: item.categoria_sugerida_id } : {}),
          },
        ];
        const parcelaTexto =
          item.parcela_atual && item.total_parcelas
            ? ` Parcela ${item.parcela_atual}/${item.total_parcelas} lançada na fatura.`
            : "";
        return createPurchase({
          purchase: {
            family_id: importacao.family_id,
            member_id: input.memberId,
            created_by: input.userId,
            estabelecimento: item.estabelecimento_sugerido || item.descricao_original,
            data_compra: item.data_lancamento ?? importacao.data_vencimento ?? new Date().toISOString().slice(0, 10),
            forma_pagamento: "CREDITO",
            credit_card_id: card.id,
            tipo_compra: "COMPRA_NORMAL",
            observacao: `Criada a partir da fatura importada (${importacao.nome_arquivo}).${parcelaTexto}`,
          },
          items: itens,
          cards: [card],
        });
      };

      if (item.match_status === "IGNORED") {
        resultado.ignorados += 1;
      } else if (item.match_status === "MATCHED" || item.match_status === "POSSIBLE_MATCH") {
        const alvo = item.installment_id_matched
          ? { tipo: "expense_installment" as const, id: item.installment_id_matched }
          : item.recurring_expense_id_matched
            ? { tipo: "recurring_expense" as const, id: item.recurring_expense_id_matched }
            : item.purchase_id_matched
              ? { tipo: "purchase" as const, id: item.purchase_id_matched }
              : null;
        if (!alvo) throw new Error("Sem correspondência escolhida para conciliar.");
        await registrarConciliacao({
          familyId: importacao.family_id,
          itemId: item.id,
          targetType: alvo.tipo,
          targetId: alvo.id,
          confidence: item.confidence_score ? Number(item.confidence_score) : null,
          userId: input.userId,
        });
        resultado.conciliados += 1;
      } else if (item.match_status === "CONFIRMED_NEW" || item.match_status === "UNMATCHED") {
        if (item.match_status === "UNMATCHED") {
          // Sem decisão explícita, nada é criado.
          resultado.ignorados += 1;
        } else {
          const compra = await criarCompra(valor);
          await updateStatementItem(item.id, { purchase_id_criada: compra.id });
          await registrarConciliacao({
            familyId: importacao.family_id,
            itemId: item.id,
            targetType: "purchase",
            targetId: compra.id,
            confidence: 1,
            userId: input.userId,
          });
          resultado.criados += 1;
        }
      } else if (item.match_status === "DIVERGENT") {
        const decisao = item.decisao as DecisaoDivergencia | null;
        if (decisao === "USAR_VALOR_FATURA" && item.purchase_id_matched) {
          const { data: compra, error } = await supabase
            .from("purchases")
            .select("valor_total")
            .eq("id", item.purchase_id_matched)
            .single();
          if (error) throw error;
          const anterior = Number(compra.valor_total) || 0;
          const { error: upError } = await supabase
            .from("purchases")
            .update({ valor_total: valor })
            .eq("id", item.purchase_id_matched);
          if (upError) throw upError;
          await registrarAuditoria({
            familyId: importacao.family_id,
            entidadeId: item.purchase_id_matched,
            valorAnterior: anterior,
            valorNovo: valor,
            userId: input.userId,
          });
          await registrarConciliacao({
            familyId: importacao.family_id,
            itemId: item.id,
            targetType: "purchase",
            targetId: item.purchase_id_matched,
            confidence: item.confidence_score ? Number(item.confidence_score) : null,
            userId: input.userId,
          });
          resultado.atualizados += 1;
        } else if (decisao === "CRIAR_NOVO") {
          const compra = await criarCompra(valor);
          await updateStatementItem(item.id, { purchase_id_criada: compra.id });
          await registrarConciliacao({
            familyId: importacao.family_id,
            itemId: item.id,
            targetType: "purchase",
            targetId: compra.id,
            confidence: 1,
            userId: input.userId,
          });
          resultado.criados += 1;
        } else if (decisao === "MANTER_VALOR" && item.purchase_id_matched) {
          await registrarConciliacao({
            familyId: importacao.family_id,
            itemId: item.id,
            targetType: "purchase",
            targetId: item.purchase_id_matched,
            confidence: item.confidence_score ? Number(item.confidence_score) : null,
            userId: input.userId,
          });
          resultado.conciliados += 1;
        } else {
          // Divergência sem decisão: fica pendente para uma próxima revisão.
          await updateStatementItem(item.id, { user_action: "PENDENTE" });
          continue;
        }
      }

      await updateStatementItem(item.id, { user_action: "CONCLUIDO" });
    } catch (e) {
      const mensagem = e instanceof Error ? e.message : "Falha ao processar o lançamento.";
      await updateStatementItem(item.id, { user_action: "ERRO", erro_mensagem: mensagem });
      resultado.erros.push({ item: item.descricao_original, mensagem });
    }
  }

  if (resultado.erros.length === 0) {
    await supabase
      .from("card_statement_imports")
      .update({ status: "CONFIRMED", confirmado_em: new Date().toISOString() })
      .eq("id", importacao.id);
  }

  return resultado;
}
