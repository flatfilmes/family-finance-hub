/**
 * LINEAGE DO EXTRATO — SOMENTE LEITURA, SEM QUALQUER GRAVAÇÃO.
 *
 * Responde a UMA pergunta por lançamento lido do PDF:
 *
 *   PARSED → RECONCILIATION → PERSISTENCE → LEDGER
 *
 * Nada aqui corrige, cria, apaga ou reinterpreta valor, sentido ou data.
 * O objetivo é provar, item a item, onde cada movimento do ParsedBankStatement
 * foi parar — e, quando não chegou ao ledger, qual etapa e qual regra o
 * descartaram. Contagem agregada não é aceita como resposta.
 *
 * IMPORTANTE — limite conhecido desta camada:
 * `bank_statement_items` NÃO guarda o `sourceId` canônico nem o `rawText`.
 * A identidade rastreável hoje é `import_id + ordem` (a ordem preserva 1:1 a
 * ordem das transactions do ParsedBankStatement, inclusive linhas repetidas).
 * Por isso o `sourceId` exibido é derivado dessa chave e sinalizado como tal.
 */
import { movementEffect } from "@/lib/bank-ledger";
import type { Transaction } from "@/lib/transactions";
import { movementKey } from "./dedupe";
import { readStatementSnapshot } from "./canonical";

export type LineageFinalStatus =
  | "PERSISTED_NEW"
  | "MATCHED_EXISTING"
  | "ALREADY_EXISTS"
  | "SKIPPED_DUPLICATE"
  | "CONFLICT"
  | "REJECTED"
  | "ERROR";

export const LINEAGE_STATUS_LABELS: Record<LineageFinalStatus, string> = {
  PERSISTED_NEW: "Criado no ledger",
  MATCHED_EXISTING: "Associado a movimento existente",
  ALREADY_EXISTS: "Já existia no ledger",
  SKIPPED_DUPLICATE: "Descartado como duplicado",
  CONFLICT: "Conflito — sem alvo comprovado",
  REJECTED: "Rejeitado antes do ledger",
  ERROR: "Erro: sumiço sem explicação",
};

export const LINEAGE_STATUS_TONES: Record<
  LineageFinalStatus,
  "ok" | "warn" | "danger" | "info" | "muted"
> = {
  PERSISTED_NEW: "ok",
  MATCHED_EXISTING: "ok",
  ALREADY_EXISTS: "info",
  SKIPPED_DUPLICATE: "warn",
  CONFLICT: "danger",
  REJECTED: "warn",
  ERROR: "danger",
};

export type LineageMutation = {
  campo: "postingDate" | "amount" | "direction" | "description";
  parsed: string;
  ledger: string;
};

export type LineageRow = {
  /** Derivado de import_id + ordem (o sourceId canônico não é persistido). */
  sourceId: string;
  importId: string;
  itemId: string;
  ordem: number;
  postingDate: string | null;
  description: string;
  amount: number;
  direction: "IN" | "OUT";
  /** Etapa 2 — o que a conciliação decidiu, sem tocar no source. */
  reconciliationStatus: string;
  reviewAction: string;
  confidence: number | null;
  /** Etapa 3 — o que a confirmação executou. */
  persistAction: string;
  ledgerTransactionId: string | null;
  ledgerDate: string | null;
  ledgerAmount: number | null;
  ledgerDirection: "IN" | "OUT" | null;
  ledgerDescription: string | null;
  finalStatus: LineageFinalStatus;
  stage: "PARSED" | "RECONCILIATION" | "PERSISTENCE" | "LEDGER";
  reason: string;
  rule: string;
  /** Obrigatório quando o status é SKIPPED_DUPLICATE. */
  matchedAgainst: {
    tipo: "LEDGER" | "ITEM_DO_MESMO_EXTRATO";
    id: string;
    data: string | null;
    valor: number;
    descricao: string;
  } | null;
  mutations: LineageMutation[];
};

export type LineageCheckpointGroup = {
  /** ParsedBankStatement.checkpoints — só existe se o bruto foi persistido. */
  pdf: number | null;
  persistidos: number;
};

export type StatementLineage = {
  importId: string;
  nomeArquivo: string;
  periodStart: string | null;
  periodEnd: string | null;
  /** Linhas do ParsedBankStatement copiadas para bank_statement_items. */
  parsedTransactions: number;
  persistedTransactions: number;
  exactMatches: number;
  missingFromLedger: LineageRow[];
  extraInLedger: Transaction[];
  mutated: LineageRow[];
  rows: LineageRow[];
  checkpoints: {
    /** Total lido do PDF, quando o bruto do parser foi persistido. */
    pdfTotal: number | null;
    daily: LineageCheckpointGroup;
    closing: LineageCheckpointGroup;
    opening: LineageCheckpointGroup;
    /** Saldos diários persistidos que conferem com o calculado do ledger. */
    dailyConferem: number;
    /** Fechamento persistido bate com o saldo final do documento. */
    closingConfere: boolean | null;
  };
  /** Data do saldo anterior lida do PDF — hoje NÃO tem coluna própria. */
  openingDate: { parsed: string | null; persisted: string | null; perdida: boolean };
};

export type LineageImportInput = {
  id: string;
  nome_arquivo: string;
  periodo_inicio: string | null;
  periodo_fim: string | null;
  saldo_inicial: number | string | null;
  saldo_final: number | string | null;
  dados_brutos_json?: unknown;
};

export type LineageItemInput = {
  id: string;
  import_id: string;
  ordem: number;
  data_movimento: string | null;
  descricao_original: string;
  valor: number | string;
  incluir?: boolean | null;
  processado?: boolean | null;
  review_action?: string | null;
  match_status?: string | null;
  confidence_score?: number | string | null;
  transaction_id_criada?: string | null;
  transaction_id_matched?: string | null;
  purchase_id_criada?: string | null;
  purchase_id_matched?: string | null;
  transfer_group_id?: string | null;
  /** Identidade primária da linha do documento (parser). */
  source_id?: string | null;
  /** Ordinal da ocorrência quando data+valor+descrição se repetem. */
  occurrence_index?: number | null;
};

const arredonda = (v: number) => Math.round(v * 100) / 100;
const CONFERE = 0.02;

/** Identidade rastreável enquanto o sourceId canônico não é persistido. */
export function lineageSourceId(importId: string, ordem: number) {
  return `${importId.slice(0, 8)}#${String(ordem).padStart(3, "0")}`;
}

function direcaoDoLedger(t: Transaction): "IN" | "OUT" {
  return movementEffect(t) >= 0 ? "IN" : "OUT";
}

/**
 * Compara o extrato lido (itens persistidos do ParsedBankStatement) com o
 * ledger real da conta. Puro: recebe dados já carregados, devolve o rastro.
 */
export function compareParsedStatementToLedger(input: {
  imp: LineageImportInput;
  items: LineageItemInput[];
  /** Movimentações da conta (já filtradas por bank_account_id). */
  transactions: Transaction[];
  checkpoints: { data: string; saldo: number; importId?: string | null; rotulo?: string | null }[];
}): StatementLineage {
  const { imp } = input;
  const items = [...input.items]
    .filter((i) => i.import_id === imp.id)
    .sort((a, b) => a.ordem - b.ordem);

  const ativas = input.transactions.filter((t) => t.status !== "CANCELADA");
  const porId = new Map(ativas.map((t) => [t.id, t]));
  const porCompra = new Map<string, Transaction>();
  for (const t of ativas) if (t.purchase_id && !porCompra.has(t.purchase_id)) porCompra.set(t.purchase_id, t);
  const porGrupo = new Map<string, Transaction>();
  for (const t of ativas)
    if (t.transfer_group_id && !porGrupo.has(t.transfer_group_id)) porGrupo.set(t.transfer_group_id, t);

  // Duplicatas dentro do próprio extrato: quem foi a primeira ocorrência.
  // IDENTIDADE: sourceId quando existir; senão chave composta + ordinal.
  //
  // Linhas antigas foram gravadas antes da identidade por linha: todas têm
  // source_id nulo e occurrence_index = 0. Confiar nesse zero faria duas
  // repetições legítimas colidirem e uma delas parecer duplicata "com alvo".
  // Por isso, na ausência de sourceId, o ordinal é RECONTADO aqui, na ordem do
  // documento — sem alterar nenhum dado gravado.
  const ordinalLegado = new Map<string, number>();
  const identidadeCache = new Map<string, string>();
  const identidade = (it: LineageItemInput) => {
    if (it.source_id) return it.source_id;
    const base = movementKey({
      data: it.data_movimento,
      valor: it.valor,
      descricao: it.descricao_original,
    });
    if (!identidadeCache.has(it.id)) {
      const occ = ordinalLegado.get(base) ?? 0;
      ordinalLegado.set(base, occ + 1);
      identidadeCache.set(it.id, `${base}#${occ}`);
    }
    return identidadeCache.get(it.id)!;
  };

  // Materializa a identidade na ordem do documento antes de qualquer consulta.
  for (const it of items) identidade(it);

  const primeiraOcorrencia = new Map<string, LineageItemInput>();
  for (const it of items) {
    const key = identidade(it);
    if (!primeiraOcorrencia.has(key)) primeiraOcorrencia.set(key, it);
  }


  const usadas = new Set<string>();
  const rows: LineageRow[] = items.map((it) => {
    const valor = Number(it.valor) || 0;
    const amount = Math.abs(valor);
    const direction: "IN" | "OUT" = valor >= 0 ? "IN" : "OUT";
    const acao = String(it.review_action ?? "");
    const criada = it.transaction_id_criada ? porId.get(it.transaction_id_criada) ?? null : null;
    const associada = it.transaction_id_matched ? porId.get(it.transaction_id_matched) ?? null : null;
    const compraId = it.purchase_id_criada ?? it.purchase_id_matched ?? null;
    const porCompraTx = compraId ? porCompra.get(compraId) ?? null : null;
    const grupoTx = it.transfer_group_id ? porGrupo.get(it.transfer_group_id) ?? null : null;
    const tx = criada ?? porCompraTx ?? grupoTx ?? associada;
    if (tx) usadas.add(tx.id);

    let finalStatus: LineageFinalStatus;
    let stage: LineageRow["stage"] = "LEDGER";
    let reason = "";
    let rule = "";
    let persistAction = "—";
    let matchedAgainst: LineageRow["matchedAgainst"] = null;

    const origem = primeiraOcorrencia.get(identidade(it));

    if (acao === "IGNORE") {
      stage = "RECONCILIATION";
      persistAction = "NENHUMA (item marcado como ignorar)";
      if (origem && origem.id !== it.id) {
        finalStatus = "SKIPPED_DUPLICATE";
        const alvo = origem.transaction_id_criada
          ? porId.get(origem.transaction_id_criada) ?? null
          : null;
        matchedAgainst = alvo
          ? {
              tipo: "LEDGER",
              id: alvo.id,
              data: alvo.data_movimento,
              valor: Number(alvo.valor),
              descricao: alvo.descricao,
            }
          : {
              tipo: "ITEM_DO_MESMO_EXTRATO",
              id: origem.id,
              data: origem.data_movimento,
              valor: Number(origem.valor),
              descricao: origem.descricao_original,
            };
        reason =
          "Mesma identidade de linha (sourceId ou chave composta + ordinal) de outra linha já resolvida.";
        rule = "dedupe.classificarDuplicados — só é duplicata com alvo concreto comprovado.";
      } else if (String(it.match_status ?? "") === "MATCHED") {
        // A regra antiga marcou como duplicata, mas a identidade recontada
        // prova que esta linha é uma OCORRÊNCIA PRÓPRIA do documento. Sem alvo
        // concreto não existe duplicata: é movimento econômico perdido.
        finalStatus = "SKIPPED_DUPLICATE";
        reason =
          "Descartado como duplicata pela chave antiga (data+valor+descrição), mas é ocorrência própria do documento — nenhum alvo concreto comprova a duplicidade.";
        rule = "dedupe legado sem occurrenceIndex — colisão de repetição legítima.";
      } else {
        finalStatus = "REJECTED";
        reason = "Item marcado como ignorar na revisão, sem alvo de duplicidade registrado.";
        rule = "review_action = IGNORE";

      }
    } else if (acao === "ASSOCIATE_EXISTING") {
      stage = "RECONCILIATION";
      persistAction = "NENHUMA (associação declarada na revisão)";
      if (tx) {
        finalStatus = "MATCHED_EXISTING";
        reason = `Associado a ${tx.descricao} (${tx.data_movimento}).`;
        rule = "reconcile: MATCHED no ledger dentro da tolerância de datas";
        matchedAgainst = {
          tipo: "LEDGER",
          id: tx.id,
          data: tx.data_movimento,
          valor: Number(tx.valor),
          descricao: tx.descricao,
        };
      } else {
        finalStatus = "CONFLICT";
        reason =
          "Marcado como já existente, porém nenhum movimento do ledger está vinculado ao item.";
        rule = "ASSOCIATE_EXISTING sem transaction_id_matched — associação sem alvo comprovado.";
      }
    } else if (tx) {
      finalStatus = criada || porCompraTx || grupoTx ? "PERSISTED_NEW" : "ALREADY_EXISTS";
      persistAction = criada
        ? "INSERT transactions"
        : porCompraTx
          ? "INSERT purchases → transação por gatilho"
          : grupoTx
            ? "transfer_between_accounts (par de transações)"
            : "associação";
      reason = `Movimento presente no ledger: ${tx.descricao} (${tx.data_movimento}).`;
      rule = `confirm_bank_statement_import · ${acao || "—"}`;
    } else if (it.processado) {
      finalStatus = "ERROR";
      stage = "PERSISTENCE";
      persistAction = "marcado como processado sem produzir movimento";
      reason = "A confirmação marcou o item como processado, mas não há movimento no ledger.";
      rule = `confirm_bank_statement_import · ${acao || "sem ação"}`;
    } else {
      finalStatus = "REJECTED";
      stage = "PERSISTENCE";
      persistAction = "pendente — importação ainda não confirmada para este item";
      reason = "Item nunca foi processado pela confirmação.";
      rule = "processado = false";
    }

    const mutations: LineageMutation[] = [];
    if (tx) {
      if (it.data_movimento && tx.data_movimento !== it.data_movimento)
        mutations.push({
          campo: "postingDate",
          parsed: it.data_movimento,
          ledger: tx.data_movimento,
        });
      if (Math.abs(Number(tx.valor) - amount) > CONFERE)
        mutations.push({
          campo: "amount",
          parsed: amount.toFixed(2),
          ledger: Number(tx.valor).toFixed(2),
        });
      const dirLedger = direcaoDoLedger(tx);
      if (finalStatus === "PERSISTED_NEW" && dirLedger !== direction)
        mutations.push({ campo: "direction", parsed: direction, ledger: dirLedger });
      if (
        finalStatus === "PERSISTED_NEW" &&
        tx.descricao.trim() !== it.descricao_original.trim()
      )
        mutations.push({
          campo: "description",
          parsed: it.descricao_original,
          ledger: tx.descricao,
        });
    }

    return {
      sourceId: lineageSourceId(imp.id, it.ordem),
      importId: imp.id,
      itemId: it.id,
      ordem: it.ordem,
      postingDate: it.data_movimento,
      description: it.descricao_original,
      amount,
      direction,
      reconciliationStatus: String(it.match_status ?? "—"),
      reviewAction: acao || "—",
      confidence: it.confidence_score === null || it.confidence_score === undefined
        ? null
        : Number(it.confidence_score),
      persistAction,
      ledgerTransactionId: tx?.id ?? null,
      ledgerDate: tx?.data_movimento ?? null,
      ledgerAmount: tx ? Number(tx.valor) : null,
      ledgerDirection: tx ? direcaoDoLedger(tx) : null,
      ledgerDescription: tx?.descricao ?? null,
      finalStatus,
      stage,
      reason,
      rule,
      matchedAgainst,
      mutations,
    };
  });

  // ---------- movimentos do ledger sem origem no extrato ----------
  const inicio = imp.periodo_inicio;
  const fim = imp.periodo_fim;
  const extraInLedger = ativas.filter(
    (t) =>
      t.tipo !== "ABERTURA_SALDO" &&
      t.tipo !== "AJUSTE_SALDO" &&
      !usadas.has(t.id) &&
      (!inicio || t.data_movimento >= inicio) &&
      (!fim || t.data_movimento <= fim),
  );

  // ---------- checkpoints ----------
  const doImport = input.checkpoints.filter((c) => c.importId === imp.id);
  const opening = doImport.filter((c) => !!inicio && c.data < inicio);
  const dentro = doImport.filter((c) => (!inicio || c.data >= inicio) && (!fim || c.data <= fim));
  const closing = dentro.filter((c) => !!fim && c.data === fim);
  const daily = dentro.filter((c) => !fim || c.data !== fim);

  // FONTE DE VERDADE do que o PDF dizia: snapshot canônico persistido.
  const snapshot = readStatementSnapshot(imp.dados_brutos_json);
  const pdfCheckpoints = snapshot?.checkpoints ?? null;
  const pdfTotal = pdfCheckpoints ? pdfCheckpoints.length : null;
  const pdfDaily = pdfCheckpoints ? pdfCheckpoints.filter((c) => c.type === "DAILY").length : null;
  const pdfClosing = pdfCheckpoints
    ? pdfCheckpoints.filter((c) => c.type === "CLOSING").length
    : null;
  const pdfOpening = snapshot?.openingBalance?.date ? 1 : pdfCheckpoints ? 0 : null;

  // Saldo calculado dia a dia dentro do período, para conferir os DAILY.
  const saldoPorDia = new Map<string, number>();
  let saldo = imp.saldo_inicial === null ? 0 : Number(imp.saldo_inicial);
  const doPeriodo = ativas
    .filter(
      (t) =>
        t.tipo !== "ABERTURA_SALDO" &&
        t.tipo !== "AJUSTE_SALDO" &&
        (!inicio || t.data_movimento >= inicio) &&
        (!fim || t.data_movimento <= fim),
    )
    .sort((a, b) => a.data_movimento.localeCompare(b.data_movimento));
  for (const t of doPeriodo) {
    saldo = arredonda(saldo + movementEffect(t));
    saldoPorDia.set(t.data_movimento, saldo);
  }
  const dailyConferem = daily.filter((c) => {
    const calculado = saldoPorDia.get(c.data);
    return calculado !== undefined && Math.abs(calculado - c.saldo) <= CONFERE;
  }).length;
  const saldoFinalDoc = imp.saldo_final === null ? null : Number(imp.saldo_final);
  const closingConfere =
    closing.length && saldoFinalDoc !== null
      ? Math.abs((closing[0]?.saldo ?? 0) - saldoFinalDoc) <= CONFERE
      : null;

  const persisted = rows.filter(
    (r) => r.finalStatus === "PERSISTED_NEW" || r.finalStatus === "MATCHED_EXISTING" || r.finalStatus === "ALREADY_EXISTS",
  );

  return {
    importId: imp.id,
    nomeArquivo: imp.nome_arquivo,
    periodStart: inicio,
    periodEnd: fim,
    parsedTransactions: items.length,
    persistedTransactions: persisted.length,
    exactMatches: persisted.filter((r) => r.mutations.length === 0).length,
    missingFromLedger: rows.filter((r) => !r.ledgerTransactionId),
    extraInLedger,
    mutated: rows.filter((r) => r.mutations.length > 0),
    rows,
    checkpoints: {
      pdfTotal,
      daily: { pdf: pdfDaily, persistidos: daily.length },
      closing: { pdf: pdfClosing, persistidos: closing.length },
      opening: { pdf: pdfOpening, persistidos: opening.length },
      dailyConferem,
      closingConfere,
    },
    openingDate: {
      parsed: snapshot?.openingBalance?.date ?? null,
      persisted: opening[opening.length - 1]?.data ?? null,
      // Só é perda quando o documento tinha a data e ela não sobreviveu.
      perdida: !!snapshot?.openingBalance?.date && !opening.length,
    },
  };
}

/** Lineage de todos os extratos da conta, na ordem cronológica do documento. */
export function buildAccountLineage(input: {
  imports: LineageImportInput[];
  items: LineageItemInput[];
  transactions: Transaction[];
  checkpoints: { data: string; saldo: number; importId?: string | null }[];
}): StatementLineage[] {
  return [...input.imports]
    .sort((a, b) => String(a.periodo_inicio ?? "").localeCompare(String(b.periodo_inicio ?? "")))
    .map((imp) =>
      compareParsedStatementToLedger({
        imp,
        items: input.items,
        transactions: input.transactions,
        checkpoints: input.checkpoints,
      }),
    );
}
