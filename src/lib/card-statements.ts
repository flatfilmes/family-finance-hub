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
import { cycleForDate, generateInstallments } from "@/lib/card-invoices";
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

/**
 * Data-âncora do ciclo importado.
 *
 * Lançamentos sem data (ex.: "Repasse de IOF") pertencem ao ciclo da fatura que
 * está sendo importada — nunca ao ciclo do vencimento. Usar o vencimento como
 * data de compra jogava o item para o mês seguinte (17/08 > fechamento 10/08).
 * Aqui devolvemos uma data que cai dentro do ciclo da própria importação.
 */
export function ancoraDoCicloImportado(
  card: Pick<CreditCard, "dia_fechamento" | "dia_vencimento">,
  importacao: Pick<StatementImport, "periodo_fim" | "data_vencimento" | "data_fechamento">,
): string | null {
  if (importacao.periodo_fim) return importacao.periodo_fim;
  const venc = importacao.data_vencimento;
  if (!venc) return importacao.data_fechamento ?? null;
  // Caminha para trás até encontrar o ciclo cujo vencimento é o da fatura.
  let ciclo = cycleForDate(card, venc);
  for (let i = 0; i < 6 && ciclo.data_vencimento !== venc; i += 1) {
    const anterior = new Date(`${ciclo.data_inicio_ciclo}T00:00:00`);
    anterior.setDate(anterior.getDate() - 1);
    ciclo = cycleForDate(card, anterior.toISOString().slice(0, 10));
  }
  return ciclo.data_vencimento === venc ? ciclo.data_fechamento : (importacao.data_fechamento ?? null);
}

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
  UNDONE: "Desfeita",
  ERROR: "Erro na leitura",

};

/** Regra única de confirmação de uma fatura importada em toda a aplicação. */
export function isStatementConfirmed(
  importacao: { status: string } | null | undefined,
) {
  return importacao?.status === "CONFIRMED";
}

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

/** Texto compacto (só letras e números) para comparar nomes de fornecedor. */
function compacto(texto: string) {
  return normalizeDescricao(texto).toLowerCase().replace(/[^a-z0-9]/g, "");
}

/** Maior trecho em comum entre dois textos compactos. */
function maiorTrechoComum(a: string, b: string) {
  let melhor = 0;
  for (let i = 0; i < a.length; i++) {
    for (let j = i + melhor + 1; j <= a.length; j++) {
      if (b.includes(a.slice(i, j))) melhor = j - i;
      else break;
    }
  }
  return melhor;
}

/**
 * Semelhança entre o nome oficial da nota ("NS2.COM INTERNET S.A.") e o nome
 * impresso na fatura ("MLP*Netshoes-NS2CO"). Além dos tokens, considera o maior
 * trecho em comum: adquirentes truncam e prefixam nomes de estabelecimento.
 */
export function similaridadeFornecedor(a: string, b: string) {
  const porTokens = similaridade(a, b);
  const ca = compacto(a);
  const cb = compacto(b);
  if (!ca || !cb) return porTokens;
  const trecho = maiorTrechoComum(ca, cb);
  // Um trecho longo em comum ("ns2co") é assinatura da marca, mesmo quando o
  // resto do nome é ruído do adquirente ("MLP*", "S.A.", "INTERNET").
  const proporcao = trecho / Math.min(ca.length, cb.length);
  const porTrecho =
    trecho >= 5 ? Math.max(0.5, proporcao) : trecho === 4 ? Math.max(0.35, proporcao) : 0;
  return Math.max(porTokens, Math.min(1, porTrecho));
}

export function diasEntre(a: string | null, b: string | null) {
  if (!a || !b) return 999;
  const da = new Date(`${a}T00:00:00Z`).getTime();
  const db = new Date(`${b}T00:00:00Z`).getTime();
  return Math.abs(Math.round((da - db) / 86_400_000));
}

const centavos = (v: number) => Math.round(Math.abs(v) * 100);

const semAcentoBaixo = (s: string) =>
  s.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase().trim();

/** Converte o nome de categoria sugerido pelo banco no id da categoria interna. */
export function categoriaPorNome(
  nome: string | null | undefined,
  categorias: { id: string; nome: string }[],
) {
  if (!nome) return null;
  const alvo = semAcentoBaixo(nome);
  return categorias.find((c) => semAcentoBaixo(c.nome) === alvo)?.id ?? null;
}


// ------------------------------------------------------------------ motor de correspondência

type Candidatos = {
  purchases: Database["public"]["Tables"]["purchases"]["Row"][];
  installments: Database["public"]["Tables"]["expense_installments"]["Row"][];
  recurring: Database["public"]["Tables"]["recurring_expenses"]["Row"][];
  /** Compra de origem de cada parcelamento, para comparar o nome do estabelecimento. */
  installmentPurchases: Record<string, { id: string; estabelecimento: string }>;
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
    // Sem filtro de cartão: a compra pode ter nascido de uma nota fiscal e ainda
    // não saber por qual cartão foi cobrada (forma de pagamento a definir).
    supabase
      .from("purchases")
      .select("*")
      .eq("family_id", input.familyId)
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

  // As parcelas de meses anteriores podem apontar para compras fora da janela
  // de datas acima; buscamos essas compras pelo id para comparar o nome.
  const idsCompras = Array.from(
    new Set((installments ?? []).map((p) => p.purchase_id).filter(Boolean) as string[]),
  );
  const installmentPurchases: Record<string, { id: string; estabelecimento: string }> = {};
  for (const p of purchases ?? []) {
    installmentPurchases[p.id] = { id: p.id, estabelecimento: p.estabelecimento };
  }
  const faltando = idsCompras.filter((id) => !installmentPurchases[id]);
  if (faltando.length > 0) {
    const { data: extras } = await supabase
      .from("purchases")
      .select("id, estabelecimento")
      .in("id", faltando);
    for (const p of extras ?? []) {
      installmentPurchases[p.id] = { id: p.id, estabelecimento: p.estabelecimento };
    }
  }

  return {
    purchases: purchases ?? [],
    installments: installments ?? [],
    recurring: recurring ?? [],
    installmentPurchases,
  };
}


/**
 * Procura a compra da nota fiscal correspondente a um lançamento parcelado
 * da fatura. Só considera compras que ainda não têm parcelamento próprio, e
 * aceita pequena diferença de arredondamento entre parcela × total e o total.
 */
function compraDaNotaFiscal(
  entry: StatementEntry,
  candidatos: Candidatos,
  usados: Set<string>,
  valorParcela: number,
) {
  const total = entry.total_parcelas ?? 0;
  if (total < 2) return null;
  const estimado = valorParcela * total;
  // Distribuição de centavos entre parcelas: 1% do total ou R$ 2,00.
  const tolerancia = Math.max(200, Math.round(estimado * 0.01));
  const comParcelamento = new Set(
    candidatos.installments.map((p) => p.purchase_id).filter(Boolean) as string[],
  );

  return (
    candidatos.purchases
      .filter((p) => !usados.has(`pur:${p.id}`) && !comParcelamento.has(p.id))
      .map((p) => ({
        p,
        sim: similaridadeFornecedor(entry.descricao_original, p.estabelecimento),
        delta: Math.abs(centavos(Number(p.valor_total)) - estimado),
        dias: diasEntre(entry.data_lancamento, p.data_compra),
      }))
      .filter((c) => c.delta <= tolerancia && c.sim >= 0.35 && c.dias <= 45)
      .sort((a, b) => b.sim - a.sim || a.delta - b.delta || a.dias - b.dias)[0] ?? null
  );
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

  // Lançamentos que não são consumo (taxas, estornos, pagamentos) não procuram
  // compra correspondente: a ação padrão deles é definida em `resolveReviewAction`.
  if (entry.tipo_sugerido !== "COMPRA") {
    return vazio;
  }


  const valor = centavos(entry.valor);

  // 1) Parcelamento já existente: a fatura traz "03/12" e o sistema já
  // conhece a série (7/10 → 8/10 → 9/10). Comparamos número da parcela,
  // total de parcelas, valor (com pequena tolerância) e nome da compra origem.
  if (entry.parcela_atual && entry.total_parcelas) {
    const nomeCompra = (purchaseId: string | null) =>
      purchaseId ? (candidatos.installmentPurchases[purchaseId]?.estabelecimento ?? "") : "";

    const serie = candidatos.installments
      .filter(
        (p) =>
          p.total_parcelas === entry.total_parcelas &&
          p.numero_parcela === entry.parcela_atual &&
          !usados.has(`inst:${p.id}`),
      )
      .map((p) => ({
        p,
        sim: similaridade(entry.descricao_original, nomeCompra(p.purchase_id)),
        delta: Math.abs(centavos(Number(p.valor_parcela)) - valor),
      }))
      .sort((a, b) => b.sim - a.sim || a.delta - b.delta);

    // Valor idêntico ou variação de até 1% (mín. R$ 0,50) conta como a mesma parcela.
    const tolerancia = Math.max(50, Math.round(valor * 0.01));
    const mesmaParcela = serie.find((c) => c.delta <= tolerancia && (c.sim >= 0.4 || serie.length === 1));
    if (mesmaParcela) {
      usados.add(`inst:${mesmaParcela.p.id}`);
      return {
        ...vazio,
        match_status: "MATCHED",
        confidence_score: mesmaParcela.sim >= 0.6 ? 0.95 : 0.85,
        installment_id_matched: mesmaParcela.p.id,
        purchase_id_matched: mesmaParcela.p.purchase_id,
        diferenca: mesmaParcela.delta === 0 ? null : Math.abs(entry.valor) - Number(mesmaParcela.p.valor_parcela),
      };
    }

    // Nome bate mas o valor não: parcela reconhecida com divergência de valor.
    const divergenteParcela = serie.find((c) => c.sim >= 0.6);
    if (divergenteParcela) {
      usados.add(`inst:${divergenteParcela.p.id}`);
      return {
        ...vazio,
        match_status: "DIVERGENT",
        confidence_score: 0.7,
        installment_id_matched: divergenteParcela.p.id,
        purchase_id_matched: divergenteParcela.p.purchase_id,
        diferenca: Math.abs(entry.valor) - Number(divergenteParcela.p.valor_parcela),
      };
    }

    // A parcela deste mês ainda não existe, mas o parcelamento existe
    // (encontramos parcelas anteriores da mesma série com o mesmo nome/valor):
    // é a continuação natural do parcelamento, nunca uma compra nova do zero.
    const anteriores = candidatos.installments
      .filter(
        (p) =>
          p.total_parcelas === entry.total_parcelas &&
          p.numero_parcela < (entry.parcela_atual ?? 0) &&
          Math.abs(centavos(Number(p.valor_parcela)) - valor) <= tolerancia,
      )
      .map((p) => ({ p, sim: similaridade(entry.descricao_original, nomeCompra(p.purchase_id)) }))
      .filter((c) => c.sim >= 0.5)
      .sort((a, b) => b.sim - a.sim || b.p.numero_parcela - a.p.numero_parcela);

    const continuidade = anteriores[0];
    if (continuidade) {
      return {
        ...vazio,
        match_status: "MATCHED",
        confidence_score: 0.8,
        installment_id_matched: continuidade.p.id,
        purchase_id_matched: continuidade.p.purchase_id,
      };
    }

    // Compra já registrada pela NOTA FISCAL, cobrada parcelada na fatura:
    // a fatura é a cobrança do mesmo evento econômico, nunca uma compra nova.
    // Sinal forte: valor da parcela × total de parcelas ≈ valor total da compra.
    const nf = compraDaNotaFiscal(entry, candidatos, usados, valor);
    if (nf) {
      usados.add(`pur:${nf.p.id}`);
      return {
        ...vazio,
        match_status: nf.sim >= 0.6 ? "MATCHED" : "POSSIBLE_MATCH",
        confidence_score: nf.sim >= 0.6 ? 0.88 : 0.62,
        purchase_id_matched: nf.p.id,
      };
    }
  }

  // 2) Recorrência já cadastrada no mesmo cartão (Google Workspace, Netflix...).
  // Aceitamos pequena variação de valor porque assinaturas reajustam.
  const tolRecorrencia = Math.max(100, Math.round(valor * 0.05));
  const recorrentes = candidatos.recurring
    .map((r) => ({
      r,
      sim: similaridade(entry.descricao_original, r.nome),
      delta: Math.abs(centavos(Number(r.valor)) - valor),
    }))
    .filter((c) => c.sim >= 0.4 && c.delta <= tolRecorrencia)
    .sort((a, b) => b.sim - a.sim || a.delta - b.delta);

  const ativa = recorrentes.filter((c) => c.r.ativo);
  const forteRecorrencia = ativa.find((c) => c.sim >= 0.6);
  if (forteRecorrencia && !usados.has(`rec:${forteRecorrencia.r.id}`)) {
    usados.add(`rec:${forteRecorrencia.r.id}`);
    return {
      ...vazio,
      match_status: "MATCHED",
      confidence_score: forteRecorrencia.delta === 0 ? 0.92 : 0.85,
      recurring_expense_id_matched: forteRecorrencia.r.id,
      diferenca: forteRecorrencia.delta === 0 ? null : Math.abs(entry.valor) - Number(forteRecorrencia.r.valor),
    };
  }
  if (recorrentes.length === 1) {
    return {
      ...vazio,
      match_status: "POSSIBLE_MATCH",
      confidence_score: 0.65,
      recurring_expense_id_matched: recorrentes[0]!.r.id,
    };
  }

  // 3) Compra avulsa já registrada no cartão.
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

  if (recorrentes.length > 1) {
    // Mais de uma recorrência parecida: nunca escolher sozinho.
    return { ...vazio, match_status: "POSSIBLE_MATCH", confidence_score: 0.4 };
  }

  return vazio;
}

// --------------------------------------------------- classificação para a revisão

/** Situação apresentada na tela de revisão, derivada do resultado da conciliação. */
export type ReviewClass =
  | "NOVO"
  | "RECORRENTE_IDENTIFICADO"
  | "PARCELA_IDENTIFICADA"
  | "POSSIVEL_MATCH"
  | "IGNORADO"
  | "TAXA";

export const REVIEW_CLASS_LABELS: Record<ReviewClass, string> = {
  NOVO: "Compra nova",
  RECORRENTE_IDENTIFICADO: "Recorrência identificada",
  PARCELA_IDENTIFICADA: "Parcela identificada",
  POSSIVEL_MATCH: "Possível correspondência",
  IGNORADO: "Item ignorável",
  TAXA: "Taxa/IOF válida",
};

export const REVIEW_CLASS_TONES: Record<ReviewClass, Tone> = {
  NOVO: "info",
  RECORRENTE_IDENTIFICADO: "ok",
  PARCELA_IDENTIFICADA: "ok",
  POSSIVEL_MATCH: "warn",
  IGNORADO: "muted",
  TAXA: "muted",
};

export function classifyReviewItem(item: {
  match_status: MatchStatus;
  tipo_sugerido: ItemKind;
  installment_id_matched: string | null;
  recurring_expense_id_matched: string | null;
}): ReviewClass {
  if (item.tipo_sugerido === "TAXA" || item.tipo_sugerido === "JUROS") return "TAXA";
  if (item.match_status === "IGNORED") return "IGNORADO";
  if (item.match_status === "MATCHED") {
    if (item.recurring_expense_id_matched) return "RECORRENTE_IDENTIFICADO";
    if (item.installment_id_matched) return "PARCELA_IDENTIFICADA";
    return "POSSIVEL_MATCH";
  }
  if (item.match_status === "POSSIBLE_MATCH" || item.match_status === "DIVERGENT") {
    return "POSSIVEL_MATCH";
  }
  return "NOVO";
}

// --------------------------------------------------- ação padrão da revisão

/**
 * Ação que será executada na confirmação da revisão.
 *
 * Princípio: todo lançamento financeiro válido ENTRA por padrão.
 * "Sem correspondência" significa "criar nova compra", nunca "não importar".
 * Ignorar é sempre uma decisão explícita do usuário.
 */
export type ReviewAction =
  | "ASSOCIATE_EXISTING"
  | "POSSIBLE_MATCH"
  | "CREATE_PURCHASE"
  | "REGISTER_FEE"
  | "REGISTER_CREDIT"
  | "IGNORE";

const REVIEW_ACTIONS: ReviewAction[] = [
  "ASSOCIATE_EXISTING",
  "POSSIBLE_MATCH",
  "CREATE_PURCHASE",
  "REGISTER_FEE",
  "REGISTER_CREDIT",
  "IGNORE",
];

export const ACTION_BADGES: Record<ReviewAction, string> = {
  ASSOCIATE_EXISTING: "Compra encontrada",
  POSSIBLE_MATCH: "Possível correspondência",
  CREATE_PURCHASE: "Nova compra",
  REGISTER_FEE: "Taxa",
  REGISTER_CREDIT: "Crédito/estorno",
  IGNORE: "Ignorado",
};

export const ACTION_TONES: Record<ReviewAction, Tone> = {
  ASSOCIATE_EXISTING: "ok",
  POSSIBLE_MATCH: "warn",
  CREATE_PURCHASE: "info",
  REGISTER_FEE: "muted",
  REGISTER_CREDIT: "muted",
  IGNORE: "muted",
};

export const ACTION_HELP: Record<ReviewAction, string> = {
  ASSOCIATE_EXISTING: "Compra existente — será associada ao confirmar.",
  POSSIBLE_MATCH: "Encontramos uma possível correspondência. Revise antes de confirmar.",
  CREATE_PURCHASE: "Nova compra — será criada ao confirmar.",
  REGISTER_FEE: "Taxa da fatura — será registrada como encargo ao confirmar.",
  REGISTER_CREDIT: "Crédito/estorno — será registrado com valor negativo ao confirmar.",
  IGNORE: "Ignorado — não será importado.",
};

type ReviewItemLike = Pick<
  StatementItem,
  | "match_status"
  | "tipo_sugerido"
  | "valor"
  | "decisao"
  | "installment_id_matched"
  | "recurring_expense_id_matched"
  | "purchase_id_matched"
>;

/** Escolha explícita do usuário, quando houver. */
export function userChoice(item: Pick<StatementItem, "decisao">): ReviewAction | null {
  const escolha = item.decisao as string | null;
  return escolha && (REVIEW_ACTIONS as string[]).includes(escolha)
    ? (escolha as ReviewAction)
    : null;
}

/** Ação vigente do lançamento: escolha do usuário ou o padrão inteligente. */
export function resolveReviewAction(item: ReviewItemLike): ReviewAction {
  const escolha = userChoice(item);
  if (escolha) return escolha;
  if (item.match_status === "IGNORED") return "IGNORE";

  const valor = Number(item.valor) || 0;
  if (item.tipo_sugerido === "PAGAMENTO") return "IGNORE";
  if (item.tipo_sugerido === "ESTORNO" || valor < 0) return "REGISTER_CREDIT";
  if (
    item.tipo_sugerido === "TAXA" ||
    item.tipo_sugerido === "JUROS" ||
    item.tipo_sugerido === "AJUSTE"
  ) {
    return "REGISTER_FEE";
  }

  if (item.match_status === "MATCHED") return "ASSOCIATE_EXISTING";
  if (item.match_status === "POSSIBLE_MATCH" || item.match_status === "DIVERGENT") {
    return "POSSIBLE_MATCH";
  }
  return "CREATE_PURCHASE";
}

/**
 * Precisa de atenção = ambiguidade real.
 * Uma compra nova comum NUNCA é problema.
 */
export function needsAttention(
  item: ReviewItemLike & { user_action: ItemAction },
): boolean {
  if (item.user_action === "ERRO") return true;
  const acao = resolveReviewAction(item);
  if (acao === "POSSIBLE_MATCH") return true;
  if (acao === "ASSOCIATE_EXISTING") {
    return (
      !item.purchase_id_matched &&
      !item.installment_id_matched &&
      !item.recurring_expense_id_matched
    );
  }
  return false;
}

export type ReviewSummary = Record<ReviewAction, number> & {
  total: number;
  atencao: number;
  incluidos: number;
};

/** Resumo do que acontecerá ao confirmar a revisão. */
export function reviewSummary(
  items: (ReviewItemLike & { user_action: ItemAction })[],
): ReviewSummary {
  const resumo: ReviewSummary = {
    ASSOCIATE_EXISTING: 0,
    POSSIBLE_MATCH: 0,
    CREATE_PURCHASE: 0,
    REGISTER_FEE: 0,
    REGISTER_CREDIT: 0,
    IGNORE: 0,
    total: items.length,
    atencao: 0,
    incluidos: 0,
  };
  for (const item of items) {
    const acao = resolveReviewAction(item);
    resumo[acao] += 1;
    if (acao !== "IGNORE") resumo.incluidos += 1;
    if (needsAttention(item)) resumo.atencao += 1;
  }
  return resumo;
}




// ------------------------------------------------------------------ conferência da fatura

export type InvoiceCheckLine = { descricao: string; valor: number };

export type InvoiceCheck = {
  compras: number;
  creditos: number;
  taxas: number;
  detalheTaxas: InvoiceCheckLine[];
  totalReconhecido: number;
  totalOficial: number;
  diferenca: number;
  confere: boolean;
};

type CheckItemLike = {
  descricao_original: string;
  valor: number | string;
  tipo_sugerido: ItemKind;
};

/**
 * Fechamento matemático da fatura: compras + créditos/estornos + taxas.
 * IOF internacional é taxa real e entra em "Taxas e serviços".
 */
export function invoiceCheck(items: CheckItemLike[], totalOficial: number): InvoiceCheck {
  const atuais = items.filter((i) => i.tipo_sugerido !== "PAGAMENTO");
  const valor = (i: CheckItemLike) => Number(i.valor) || 0;
  const ehTaxa = (i: CheckItemLike) =>
    valor(i) > 0 &&
    (i.tipo_sugerido === "TAXA" || i.tipo_sugerido === "JUROS" || i.tipo_sugerido === "AJUSTE");
  const compras = atuais
    .filter((i) => i.tipo_sugerido === "COMPRA" && valor(i) > 0)
    .reduce((a, i) => a + valor(i), 0);
  const creditos = atuais
    .filter((i) => valor(i) < 0 || i.tipo_sugerido === "ESTORNO")
    .reduce((a, i) => a + valor(i), 0);
  const detalheTaxas = atuais
    .filter(ehTaxa)
    .map((i) => ({ descricao: i.descricao_original, valor: valor(i) }));
  const taxas = detalheTaxas.reduce((a, l) => a + l.valor, 0);
  const totalReconhecido = atuais.reduce((a, i) => a + valor(i), 0);
  const diferenca = totalOficial - totalReconhecido;
  return {
    compras: round2(compras),
    creditos: round2(creditos),
    taxas: round2(taxas),
    detalheTaxas,
    totalReconhecido: round2(totalReconhecido),
    totalOficial: round2(totalOficial),
    diferenca: round2(diferenca),
    confere: totalOficial > 0 && Math.abs(diferenca) < 0.01,
  };
}

const round2 = (v: number) => Math.round(v * 100) / 100;

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

/**
 * Faturas importadas da família. Quando `cardId` é informado, retorna apenas as
 * importações daquele cartão — a página do cartão é a fonte principal da lista.
 */
export async function fetchStatementImports(familyId: string, cardId?: string) {
  let query = supabase
    .from("card_statement_imports")
    .select("*")
    .eq("family_id", familyId)
    .order("created_at", { ascending: false });
  if (cardId) query = query.eq("credit_card_id", cardId);
  const { data, error } = await query;
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

// ------------------------------------------------------- desfazer importação

/** Relatório do que será revertido — nada é alterado no banco. */
export type UndoReport = {
  import_id: string;
  status: ImportStatus;
  ja_desfeita: boolean;
  nome_arquivo: string;
  confirmado_em: string | null;
  quantidade_lancamentos: number;
  compras_criadas_exclusivas: number;
  compras_compartilhadas: number;
  compras_associadas: number;
  parcelas: number;
  taxas: number;
  creditos: number;
  ignorados: number;
  bloqueios: {
    purchase_id: string;
    estabelecimento: string;
    valor: number;
    motivos: string[];
  }[];
  exige_revisao_manual: boolean;
};

export type UndoResult = {
  resultado: "UNDONE" | "ALREADY_UNDONE";
  import_id: string;
  compras_removidas?: number;
  compras_preservadas?: number;
  compras_bloqueadas?: number;
  vinculos_removidos?: number;
};

/** Só faz sentido desfazer o que já foi confirmado (cancelar é para revisão pendente). */
export function podeDesfazerImportacao(status: ImportStatus) {
  return isStatementConfirmed({ status });
}

export async function inspectUndoStatementImport(importId: string): Promise<UndoReport> {
  const { data, error } = await supabase.rpc("inspect_card_statement_import_undo", {
    p_import_id: importId,
  });
  if (error) throw error;
  return data as unknown as UndoReport;
}

/**
 * Reverte apenas os efeitos exclusivos desta importação, de forma transacional.
 * Compras de nota fiscal, compras usadas por outra importação e qualquer
 * histórico bancário confirmado são sempre preservados.
 */
export async function undoStatementImport(
  importId: string,
  aceitarPendencias = false,
): Promise<UndoResult> {
  const { data, error } = await supabase.rpc("undo_card_statement_import", {
    p_import_id: importId,
    p_aceitar_pendencias: aceitarPendencias,
  });
  if (error) throw error;
  return data as unknown as UndoResult;
}

/** Faturas confirmadas geraram efeito real: não podem ser apagadas direto. */
export function podeExcluirImportacao(status: ImportStatus) {
  return !isStatementConfirmed({ status });
}

/**
 * Exclusão manual de uma fatura importada.
 * Remove apenas dados temporários da importação (lançamentos lidos do PDF,
 * conciliações registradas e a própria importação). Nunca toca em compras,
 * parcelas, recorrências ou faturas reais do sistema.
 */
export async function deleteStatementImport(id: string) {
  const { data: importacao, error: readError } = await supabase
    .from("card_statement_imports")
    .select("id, status")
    .eq("id", id)
    .maybeSingle();
  if (readError) throw readError;
  if (!importacao) throw new Error("Fatura importada não encontrada.");
  if (!podeExcluirImportacao(importacao.status)) {
    throw new Error(
      "Esta fatura já foi confirmada e teve efeito no sistema. Desfaça/cancele a revisão antes de excluir.",
    );
  }

  const { data: itens, error: itensError } = await supabase
    .from("card_statement_items")
    .select("id, purchase_id_criada")
    .eq("import_id", id);
  if (itensError) throw itensError;

  const criadas = (itens ?? []).filter((i) => i.purchase_id_criada);
  if (criadas.length > 0) {
    throw new Error(
      "Esta importação já criou compras no sistema. Exclua ou ajuste essas compras antes de remover a fatura.",
    );
  }

  const ids = (itens ?? []).map((i) => i.id);
  if (ids.length > 0) {
    // Conciliações apontam para o lançamento temporário: saem junto com ele.
    const { error: recError } = await supabase
      .from("reconciliations")
      .delete()
      .eq("source_type", "card_statement_item")
      .in("source_id", ids);
    if (recError) throw recError;

    const { error: delItens } = await supabase
      .from("card_statement_items")
      .delete()
      .eq("import_id", id);
    if (delItens) throw delItens;
  }

  const { error: delImport } = await supabase
    .from("card_statement_imports")
    .delete()
    .eq("id", id);
  if (delImport) throw delImport;
}

// --------------------------------------------------- diagnóstico da preparação

/** Etapas do fluxo "preparar revisão", usadas nos logs de desenvolvimento. */
export type PrepareStep =
  | "VALIDATE_CARD"
  | "CREATE_IMPORT"
  | "FETCH_CANDIDATES"
  | "MATCHING"
  | "CREATE_ITEMS"
  | "READY";

const isDev = typeof import.meta !== "undefined" && !!import.meta.env?.DEV;

function logStep(step: PrepareStep, fase: "START" | "SUCCESS" | "ERROR", extra?: unknown) {
  if (!isDev) return;
  // eslint-disable-next-line no-console
  console.info(`[fatura:${fase}] ${step}`, extra ?? "");
}

type SupabaseLikeError = { message?: string; code?: string; details?: string; hint?: string };

/** Erro técnico com a etapa exata e o registro que falhou. */
export class PrepareStatementError extends Error {
  step: PrepareStep;
  detalhe: string;
  contexto: Record<string, unknown> | null;
  constructor(step: PrepareStep, causa: unknown, contexto?: Record<string, unknown>) {
    const e = (causa ?? {}) as SupabaseLikeError;
    const partes = [e.message, e.code && `code=${e.code}`, e.details, e.hint].filter(Boolean);
    const detalhe = partes.join(" · ") || "Erro desconhecido";
    super(detalhe);
    this.name = "PrepareStatementError";
    this.step = step;
    this.detalhe = detalhe;
    this.contexto = contexto ?? null;
    logStep(step, "ERROR", { detalhe, ...(contexto ?? {}) });
  }
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
  // O total extraído considera apenas o consumo do ciclo: pagamento da fatura
  // anterior é informativo e nunca entra na soma.
  const totalExtraido = parsed.entries
    .filter((e) => e.tipo_sugerido !== "PAGAMENTO")
    .reduce((acc, e) => acc + e.valor, 0);
  const fingerprint = statementFingerprint({
    cardId: input.card.id,
    vencimento: parsed.data_vencimento,
    total: parsed.valor_total_fatura,
    periodoInicio: parsed.periodo_inicio,
    quantidade: parsed.entries.length,
  });

  logStep("VALIDATE_CARD", "START", { cardId: input.card.id, familyId: input.familyId });
  if (!input.familyId || !input.card?.id) {
    throw new PrepareStatementError("VALIDATE_CARD", {
      message: "Cartão ou família não identificados para esta importação.",
    });
  }
  logStep("VALIDATE_CARD", "SUCCESS");

  logStep("CREATE_IMPORT", "START", { arquivo: input.file.name, lancamentos: parsed.entries.length });
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
      dados_brutos_json: {
        linhas: parsed.linhas.slice(0, 400),
        arquivo: input.file.name,
        metadata: parsed.metadata ?? null,
        subtotais: parsed.subtotais ?? [],
        futuras: (parsed.futuras ?? []).slice(0, 200),
        extraction_status: parsed.extraction_status ?? "READY",
        positional_debug: parsed.positional_debug ?? [],
      },
    })

    .select()
    .single();
  if (error || !importacao) {
    throw new PrepareStatementError("CREATE_IMPORT", error, {
      tabela: "card_statement_imports",
      cardId: input.card.id,
    });
  }
  logStep("CREATE_IMPORT", "SUCCESS", { importId: importacao.id });

  try {
    // A janela de busca considera o período da fatura E as datas dos lançamentos
    // (compras podem ter data fora do ciclo informado no cabeçalho), com folga de 10 dias.
    logStep("FETCH_CANDIDATES", "START");
    const datas = parsed.entries.map((e) => e.data_lancamento).filter(Boolean) as string[];
    const desloca = (data: string, dias: number) => {
      const d = new Date(`${data}T12:00:00`);
      d.setDate(d.getDate() + dias);
      return d.toISOString().slice(0, 10);
    };
    const limites = [parsed.periodo_inicio, parsed.periodo_fim, ...datas].filter(Boolean) as string[];
    let candidatos: Candidatos = {
      purchases: [],
      installments: [],
      recurring: [],
      installmentPurchases: {},
    };
    try {
      candidatos = await fetchMatchCandidates({
        familyId: input.familyId,
        cardId: input.card.id,
        inicio: limites.length ? desloca(limites.slice().sort()[0]!, -10) : null,
        fim: limites.length ? desloca(limites.slice().sort().at(-1)!, 10) : null,
      });
    } catch (e) {
      // A comparação é um conforto, não um requisito: seguimos sem candidatos.
      logStep("FETCH_CANDIDATES", "ERROR", e);
    }
    logStep("FETCH_CANDIDATES", "SUCCESS", { compras: candidatos.purchases.length });


    logStep("MATCHING", "START");
    const usados = new Set<string>();

    const rows = parsed.entries.map((entry, index) => {
      // Um erro de comparação em um lançamento não pode derrubar os outros 93.
      let resultado: ReturnType<typeof matchEntry>;
      try {
        resultado = matchEntry(entry, candidatos, usados);
      } catch (e) {
        logStep("MATCHING", "ERROR", { index, descricao: entry.descricao_original, e });
        resultado = { match_status: "UNMATCHED" } as ReturnType<typeof matchEntry>;
      }
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
        card_last4: entry.card_last4 ?? null,
        categoria_sugerida_id:
          entry.tipo_sugerido === "COMPRA"
            ? (categoriaPorNome(entry.categoria_banco, input.categorias) ??
              suggestCategoryId(entry.descricao_original, input.categorias))
            : null,
        ordem: index,
        ...resultado,
      };
    });
    logStep("MATCHING", "SUCCESS", { itens: rows.length });

    logStep("CREATE_ITEMS", "START", { itens: rows.length });
    // Em blocos: se falhar, sabemos exatamente qual lançamento quebrou.
    const bloco = 50;
    for (let i = 0; i < rows.length; i += bloco) {
      const parte = rows.slice(i, i + bloco);
      const { error: itemsError } = await supabase.from("card_statement_items").insert(parte);
      if (itemsError) {
        // Isola o item problemático dentro do bloco para o relatório de DEV.
        let culpado: (typeof parte)[number] | null = null;
        for (const row of parte) {
          const { error: unitError } = await supabase.from("card_statement_items").insert(row);
          if (unitError) {
            culpado = row;
            break;
          }
        }
        throw new PrepareStatementError("CREATE_ITEMS", itemsError, {
          tabela: "card_statement_items",
          itemIndex: culpado ? `${(culpado.ordem ?? 0) + 1}/${rows.length}` : `bloco ${i + 1}-${i + parte.length}`,
          data: culpado?.data_lancamento ?? null,
          descricao: culpado?.descricao_original ?? null,
          valor: culpado?.valor ?? null,
          tipo: culpado?.tipo_sugerido ?? null,
          parcela: culpado ? `${culpado.parcela_atual ?? "-"}/${culpado.total_parcelas ?? "-"}` : null,
          card_last4: culpado?.card_last4 ?? null,
        });
      }
    }
    logStep("CREATE_ITEMS", "SUCCESS");

    await supabase
      .from("card_statement_imports")
      .update({ status: "READY_FOR_REVIEW" })
      .eq("id", importacao.id);

    logStep("READY", "SUCCESS", { importId: importacao.id });
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

/**
 * A fatura ENRIQUECE a compra da nota fiscal: registra cartão, parcelamento e
 * a cobrança do ciclo, sem alterar o valor total nem os produtos reais da nota.
 * Não cria nenhuma compra nova.
 */
async function enriquecerCompraComCobranca(input: {
  purchaseId: string;
  item: StatementItem;
  card: CreditCard;
  userId: string | null;
}) {
  const { item, card } = input;
  const parcelas = item.total_parcelas ?? 1;
  const parcelaAtual = item.parcela_atual ?? 1;
  const valorParcela = Math.abs(Number(item.valor) || 0);

  const { data: compra, error } = await supabase
    .from("purchases")
    .select("*")
    .eq("id", input.purchaseId)
    .single();
  if (error) throw error;

  // Já existe parcelamento para esta compra: nada a fazer (idempotente).
  const { data: existentes, error: exError } = await supabase
    .from("expense_installments")
    .select("id")
    .eq("purchase_id", input.purchaseId)
    .limit(1);
  if (exError) throw exError;
  if ((existentes ?? []).length > 0) return;

  const parcelado = parcelas > 1;
  await supabase
    .from("purchases")
    .update({
      credit_card_id: card.id,
      forma_pagamento: "CREDITO",
      bank_account_id: null,
      ...(parcelado ? { tipo_compra: "COMPRA_PARCELADA" as const } : {}),
      ...(compra.status_pagamento === "PENDENTE_PAGAMENTO" ||
      compra.status_pagamento === "PENDENTE"
        ? { status_pagamento: "COMPROMETIDO" as const }
        : {}),
      observacao: `${compra.observacao ?? ""} Cobrança identificada na fatura como "${item.descricao_original}".`.trim(),
    })
    .eq("id", input.purchaseId);

  const valorTotal = Number(compra.valor_total) || valorParcela * parcelas;
  const { data: expense, error: expenseError } = await supabase
    .from("expenses")
    .insert({
      family_id: compra.family_id,
      member_id: compra.member_id,
      created_by: input.userId,
      purchase_id: compra.id,
      descricao: compra.estabelecimento,
      valor: valorTotal,
      data_compra: compra.data_compra,
      forma_pagamento: "CREDITO",
      tipo_compra: parcelado ? "PARCELADO" : "CARTAO_CREDITO",
      cartao_id: card.id,
      parcelas_total: parcelas,
      parcela_atual: parcelaAtual,
    })
    .select()
    .single();
  if (expenseError) throw expenseError;

  await generateInstallments({
    familyId: compra.family_id,
    expenseId: expense.id,
    card,
    dataCompra: item.data_lancamento ?? compra.data_compra,
    valorTotal,
    parcelas,
    parcelaInicial: parcelaAtual,
    valorParcela,
    memberId: compra.member_id,
    purchaseId: compra.id,
  });
}

export type ConfirmResult = {
  conciliados: number;
  criados: number;
  taxas: number;
  creditos: number;
  ignorados: number;
  atualizados: number;
  erros: { item: string; mensagem: string }[];
};

/** Já existe conciliação registrada para este lançamento? (idempotência) */
async function jaConciliado(itemId: string) {
  const { data, error } = await supabase
    .from("reconciliations")
    .select("id")
    .eq("source_type", "card_statement_item")
    .eq("source_id", itemId)
    .limit(1);
  if (error) throw error;
  return (data ?? []).length > 0;
}

/**
 * Aplica as decisões da revisão, item por item, com status explícito em cada
 * lançamento. O processamento é idempotente: item já concluído, já conciliado
 * ou que já criou compra nunca é processado de novo.
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
    taxas: 0,
    creditos: 0,
    ignorados: 0,
    atualizados: 0,
    erros: [],
  };

  for (const item of input.items) {
    // Idempotência: nada é refeito.
    if (item.user_action === "CONCLUIDO" || item.purchase_id_criada) continue;
    await updateStatementItem(item.id, { user_action: "PROCESSANDO", erro_mensagem: null });

    try {
      const bruto = Number(item.valor) || 0;
      const valor = Math.abs(bruto);
      const acao = resolveReviewAction(item);

      /**
       * Cria a compra pelo caminho oficial (`createPurchase`), respeitando
       * parcelamentos: 3/6 entra como série de 6 conhecida a partir da 3ª.
       */
      const criarCompra = async (opcoes: {
        valorItem: number;
        natureza: "COMPRA" | "TAXA" | "CREDITO";
      }) => {
        const parcelado =
          opcoes.natureza === "COMPRA" &&
          !!item.parcela_atual &&
          !!item.total_parcelas &&
          item.total_parcelas > 1;
        const restantes = parcelado
          ? item.total_parcelas! - item.parcela_atual! + 1
          : 1;
        const valorCompra = parcelado
          ? Math.round(opcoes.valorItem * restantes * 100) / 100
          : opcoes.valorItem;

        const nota =
          opcoes.natureza === "TAXA"
            ? " Encargo/taxa lançado pela fatura — não é consumo."
            : opcoes.natureza === "CREDITO"
              ? " Crédito/estorno lançado pela fatura."
              : parcelado
                ? ` Parcelamento reconhecido a partir da parcela ${item.parcela_atual}/${item.total_parcelas} (parcelas anteriores são históricas).`
                : "";

        const itens: NewPurchaseItem[] = [
          {
            product_id: "",
            descricao_produto: item.estabelecimento_sugerido || item.descricao_original,
            quantidade: "1",
            unidade: "UN",
            valor_unitario: String(valorCompra),
            categoria_id: item.categoria_sugerida_id ?? "",
            ...(item.categoria_sugerida_id
              ? { categoria_sugerida: item.categoria_sugerida_id }
              : {}),
          },
        ];

        return createPurchase({
          purchase: {
            family_id: importacao.family_id,
            member_id: input.memberId,
            created_by: input.userId,
            estabelecimento: item.estabelecimento_sugerido || item.descricao_original,
            data_compra:
              item.data_lancamento ??
              importacao.data_vencimento ??
              new Date().toISOString().slice(0, 10),
            forma_pagamento: "CREDITO",
            credit_card_id: card.id,
            tipo_compra: parcelado ? "COMPRA_PARCELADA" : "COMPRA_NORMAL",
            observacao: `Criada a partir da fatura importada (${importacao.nome_arquivo}).${nota}`,
          },
          items: itens,
          cards: [card],
          ...(parcelado
            ? {
                parcelas: item.total_parcelas!,
                parcelaInicial: item.parcela_atual!,
                valorParcela: opcoes.valorItem,
              }
            : {}),
        });
      };

      const associar = async () => {
        const alvo = item.installment_id_matched
          ? { tipo: "expense_installment" as const, id: item.installment_id_matched }
          : item.recurring_expense_id_matched
            ? { tipo: "recurring_expense" as const, id: item.recurring_expense_id_matched }
            : item.purchase_id_matched
              ? { tipo: "purchase" as const, id: item.purchase_id_matched }
              : null;
        if (!alvo) throw new Error("Sem correspondência escolhida para conciliar.");
        // Compra da nota fiscal cobrada no cartão: a fatura só acrescenta
        // cartão, parcelamento e cobrança à compra que já existe.
        if (alvo.tipo === "purchase" && item.tipo_sugerido === "COMPRA") {
          await enriquecerCompraComCobranca({
            purchaseId: alvo.id,
            item,
            card,
            userId: input.userId,
          });
        }
        if (!(await jaConciliado(item.id))) {
          await registrarConciliacao({
            familyId: importacao.family_id,
            itemId: item.id,
            targetType: alvo.tipo,
            targetId: alvo.id,
            confidence: item.confidence_score ? Number(item.confidence_score) : null,
            userId: input.userId,
          });
        }
        resultado.conciliados += 1;
      };

      const criarEConciliar = async (
        natureza: "COMPRA" | "TAXA" | "CREDITO",
        valorItem: number,
      ) => {
        const compra = await criarCompra({ valorItem, natureza });
        await updateStatementItem(item.id, { purchase_id_criada: compra.id });
        if (!(await jaConciliado(item.id))) {
          await registrarConciliacao({
            familyId: importacao.family_id,
            itemId: item.id,
            targetType: "purchase",
            targetId: compra.id,
            confidence: 1,
            userId: input.userId,
          });
        }
      };

      if (acao === "IGNORE") {
        // O lançamento continua existindo na importação, apenas marcado como ignorado.
        await updateStatementItem(item.id, { match_status: "IGNORED" });
        resultado.ignorados += 1;
      } else if (acao === "REGISTER_FEE") {
        await criarEConciliar("TAXA", valor);
        resultado.taxas += 1;
      } else if (acao === "REGISTER_CREDIT") {
        // Crédito/estorno preserva o sinal negativo: reduz a fatura.
        await criarEConciliar("CREDITO", -valor);
        resultado.creditos += 1;
      } else if (acao === "ASSOCIATE_EXISTING") {
        await associar();
      } else if (acao === "POSSIBLE_MATCH") {
        // Divergência de valor com decisão explícita mantém o fluxo já validado.
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
          await associar();
          resultado.conciliados -= 1;
          resultado.atualizados += 1;
        } else if (decisao === "MANTER_VALOR" && item.purchase_id_matched) {
          await associar();
        } else {
          // Sem escolha do usuário, o fallback declarado é criar a compra nova.
          await criarEConciliar("COMPRA", valor);
          resultado.criados += 1;
        }
      } else {
        await criarEConciliar("COMPRA", valor);
        resultado.criados += 1;
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

