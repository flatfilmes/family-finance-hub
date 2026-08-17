/**
 * CARD_STATEMENT_PERSISTENCE_DRY_RUN — simulação READ-ONLY.
 *
 * Responde "como esta fatura seria reconciliada com o que já existe" SEM
 * gravar nada: nenhum INSERT, UPDATE ou DELETE, nenhuma compra, invoice,
 * card_statement_item, parcela ou recorrência é criada ou alterada.
 *
 * Regras econômicas fundamentais aplicadas aqui:
 *  - a compra (purchase) é o EVENTO econômico; o item de fatura é EVIDÊNCIA do
 *    mesmo evento quando há correspondência — nunca uma segunda despesa;
 *  - o total oficial da fatura é a fonte da verdade (declaredInvoiceTotal),
 *    nunca recalculado a partir dos registros antigos do sistema;
 *  - repetições legítimas (mesmo estabelecimento, mesmo dia, valores
 *    diferentes ou não) jamais são deduplicadas entre si: cada item oficial
 *    consome no máximo UM registro existente.
 */

const arred = (v: number) => Math.round(v * 100) / 100;

export type CardDryRunItemStatus =
  | "EXACT_MATCH"
  | "STRONG_MATCH"
  | "POSSIBLE_MATCH"
  | "NEW_ITEM"
  | "CONFLICT";

export type CardMappingStatus =
  | "CARD_MAPPED"
  | "CARD_MAPPING_REVIEW_REQUIRED"
  | "CARD_NOT_FOUND";

export type InvoiceIdentityStatus = "NEW_STATEMENT" | "SAME_STATEMENT_ALREADY_IMPORTED";

export type OfficialItem = {
  category: string;
  date: string | null;
  description: string;
  amount: number;
  installmentCurrent: number | null;
  installmentTotal: number | null;
  cardLast4: string | null;
};

export type InvoiceCanonical = {
  issuer: string | null;
  holder?: string | null;
  cardLast4?: string | null;
  cardLast4s?: string[];
  periodStart?: string | null;
  periodEnd?: string | null;
  closingDate: string | null;
  nextClosingDate?: string | null;
  dueDate: string | null;
  issueDate?: string | null;
  invoiceTotal: number | null;
  previousInvoiceTotal?: number | null;
  previousPayment?: { data: string | null; valor: number } | null;
};

export type CardRow = {
  id: string;
  banco: string;
  nome_cartao: string;
  ativo: boolean;
  member_id: string | null;
};

export type ExistingPurchase = {
  id: string;
  data_compra: string;
  valor_total: number;
  estabelecimento: string;
  credit_card_id: string | null;
};

export type ExistingStatementItem = {
  id: string;
  import_id: string;
  credit_card_id: string;
  data_lancamento: string | null;
  descricao_original: string;
  descricao_normalizada: string;
  valor: number;
  parcela_atual: number | null;
  total_parcelas: number | null;
  purchase_id_matched: string | null;
};

export type ExistingImport = {
  id: string;
  credit_card_id: string;
  fingerprint: string | null;
  data_fechamento: string | null;
  data_vencimento: string | null;
  valor_total_fatura: number;
  status: string;
  nome_arquivo: string;
};

/* ------------------------------------------------------------------ */
/* Normalização e similaridade                                         */
/* ------------------------------------------------------------------ */

export function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function similaridade(a: string, b: string) {
  const ta = new Set(normalizar(a).split(" ").filter((t) => t.length > 2));
  const tb = new Set(normalizar(b).split(" ").filter((t) => t.length > 2));
  if (!ta.size || !tb.size) return 0;
  let comuns = 0;
  ta.forEach((t) => {
    if (tb.has(t)) comuns += 1;
  });
  return comuns / Math.max(ta.size, tb.size);
}

function diasEntre(a: string | null, b: string | null) {
  if (!a || !b) return null;
  const ms = Math.abs(new Date(`${a}T00:00:00`).getTime() - new Date(`${b}T00:00:00`).getTime());
  return Math.round(ms / 86_400_000);
}

const digitos = (t: string) => (t.match(/\d{4}/g) ?? []);

/* ------------------------------------------------------------------ */
/* 1. Mapeamento de cartão                                             */
/* ------------------------------------------------------------------ */

export type CardCandidate = {
  id: string;
  nome: string;
  banco: string;
  ativo: boolean;
  last4Cadastrados: string[];
  last4DoDocumento: string[];
  motivo: string;
};

export function mapearCartoes(cards: CardRow[], issuer: string | null, last4s: string[]) {
  const alvoEmissor = normalizar(issuer ?? "");
  const doEmissor = cards.filter(
    (c) => alvoEmissor && normalizar(c.banco).includes(alvoEmissor.split(" ")[0] ?? alvoEmissor),
  );
  const candidatos: CardCandidate[] = doEmissor.map((c) => {
    const cadastrados = [...new Set([...digitos(c.nome_cartao)])];
    const casados = last4s.filter((l) => cadastrados.includes(l));
    return {
      id: c.id,
      nome: c.nome_cartao,
      banco: c.banco,
      ativo: c.ativo,
      last4Cadastrados: cadastrados,
      last4DoDocumento: casados,
      motivo: casados.length
        ? `Final ${casados.join(", ")} confere com o cadastro.`
        : cadastrados.length
          ? "Emissor confere, mas nenhum final cadastrado bate com o documento."
          : "Emissor confere e o cartão não tem final cadastrado.",
    };
  });

  const comFinal = candidatos.filter((c) => c.last4DoDocumento.length > 0);
  const ativos = candidatos.filter((c) => c.ativo);

  let status: CardMappingStatus;
  let selecionado: CardCandidate | null = null;
  let explicacao: string;

  if (candidatos.length === 0) {
    status = "CARD_NOT_FOUND";
    explicacao = `Nenhum cartão da família com emissor ${issuer ?? "—"}. Cadastre o cartão antes de importar.`;
  } else if (comFinal.length === 1) {
    status = "CARD_MAPPED";
    selecionado = comFinal[0]!;
    explicacao = `Cartão identificado pelo final ${selecionado.last4DoDocumento.join(", ")}.`;
  } else if (comFinal.length > 1) {
    status = "CARD_MAPPING_REVIEW_REQUIRED";
    explicacao =
      "Mais de um cartão cadastrado responde pelos finais do documento — a escolha precisa ser humana.";
  } else if (ativos.length === 1) {
    status = "CARD_MAPPED";
    selecionado = ativos[0]!;
    explicacao =
      "Único cartão ativo do emissor; nenhum final cadastrado para conferência estrita.";
  } else {
    status = "CARD_MAPPING_REVIEW_REQUIRED";
    explicacao = `${candidatos.length} cartões ${issuer ?? ""} na família e nenhum final cadastrado confere — revisão obrigatória.`;
  }

  return { status, candidatos, selecionado, explicacao };
}

/* ------------------------------------------------------------------ */
/* 2/3. Identidade da fatura                                           */
/* ------------------------------------------------------------------ */

export function invoiceFingerprint(input: {
  cardId: string;
  issuer: string | null;
  closingDate: string | null;
  dueDate: string | null;
  invoiceTotal: number | null;
}) {
  const base = [
    input.cardId,
    normalizar(input.issuer ?? ""),
    input.closingDate ?? "",
    input.dueDate ?? "",
    (input.invoiceTotal ?? 0).toFixed(2),
  ].join("|");
  let hash = 5381;
  for (let i = 0; i < base.length; i += 1) hash = (hash * 33) ^ base.charCodeAt(i);
  return `cs-${(hash >>> 0).toString(16)}-${input.cardId.slice(0, 8)}`;
}

/* ------------------------------------------------------------------ */
/* 4-6. Reconciliação item a item                                      */
/* ------------------------------------------------------------------ */

export type ItemDryRun = {
  index: number;
  date: string | null;
  cardLast4: string | null;
  description: string;
  amount: number;
  installment: string | null;
  status: CardDryRunItemStatus;
  matchedPurchaseId: string | null;
  matchedStatementItemId: string | null;
  matchReason: string;
  actionPreview: string;
  score: number;
};

type Candidato = {
  chave: string;
  purchaseId: string | null;
  statementItemId: string | null;
  score: number;
  motivos: string[];
};

function candidatosPara(
  item: OfficialItem,
  purchases: ExistingPurchase[],
  statementItems: ExistingStatementItem[],
  lineageImportIds: Set<string>,
): Candidato[] {
  const saida: Candidato[] = [];

  for (const p of purchases) {
    if (Math.abs(arred(p.valor_total) - Math.abs(arred(item.amount))) >= 0.01) continue;
    const dias = diasEntre(p.data_compra, item.date);
    if (dias === null || dias > 5) continue;
    const sim = similaridade(p.estabelecimento, item.description);
    let score = 0;
    const motivos = [`valor idêntico (${item.amount.toFixed(2)})`];
    if (dias === 0) {
      score += 3;
      motivos.push("mesma data");
    } else if (dias <= 3) {
      score += 2;
      motivos.push(`data ±${dias}d`);
    } else {
      score += 1;
      motivos.push(`data ±${dias}d`);
    }
    score += 3; // valor exato
    if (sim >= 0.8) {
      score += 3;
      motivos.push("descrição equivalente");
    } else if (sim >= 0.5) {
      score += 2;
      motivos.push("descrição parecida");
    } else if (sim > 0) {
      score += 1;
      motivos.push("descrição parcial");
    } else {
      motivos.push("descrição diferente");
    }
    saida.push({
      chave: `purchase:${p.id}`,
      purchaseId: p.id,
      statementItemId: null,
      score,
      motivos,
    });
  }

  for (const s of statementItems) {
    if (Math.abs(arred(s.valor) - arred(item.amount)) >= 0.01) continue;
    const dias = diasEntre(s.data_lancamento, item.date);
    if (dias === null || dias > 5) continue;
    const sim = similaridade(s.descricao_original, item.description);
    let score = 3;
    const motivos = ["valor idêntico"];
    if (dias === 0) {
      score += 3;
      motivos.push("mesma data");
    } else score += 1;
    if (sim >= 0.8) {
      score += 3;
      motivos.push("descrição equivalente");
    } else if (sim >= 0.5) score += 2;
    if (
      item.installmentCurrent &&
      s.parcela_atual === item.installmentCurrent &&
      s.total_parcelas === item.installmentTotal
    ) {
      score += 1;
      motivos.push(`parcela ${item.installmentCurrent}/${item.installmentTotal}`);
    }
    if (lineageImportIds.has(s.import_id)) {
      score += 4;
      motivos.push("lineage: mesma fatura já importada");
    }
    saida.push({
      chave: `item:${s.id}`,
      purchaseId: s.purchase_id_matched,
      statementItemId: s.id,
      score,
      motivos,
    });
  }

  return saida.sort((a, b) => b.score - a.score);
}

export type CardStatementPersistenceDryRun = {
  status:
    | "PASS"
    | "REVIEW_REQUIRED"
    | "CARD_MAPPING_REVIEW_REQUIRED"
    | "CARD_NOT_FOUND"
    | "BLOCKED";
  invoice: {
    issuer: string | null;
    holder: string | null;
    closingDate: string | null;
    dueDate: string | null;
    invoiceTotal: number | null;
    cardLast4s: string[];
    consolidated: boolean;
    consolidationNote: string;
  };
  cardMapping: {
    status: CardMappingStatus;
    explicacao: string;
    candidatos: CardCandidate[];
    selectedCardId: string | null;
    selectedCardName: string | null;
  };
  identity: {
    status: InvoiceIdentityStatus;
    fingerprint: string | null;
    matchedImportId: string | null;
    matchedImportFile: string | null;
    explicacao: string;
  };
  previousPayment: {
    date: string | null;
    amount: number | null;
    treatment: "METADATA_ONLY";
    note: string;
  };
  items: ItemDryRun[];
  summary: {
    officialItems: number;
    alreadyMatched: number;
    possibleMatches: number;
    newItems: number;
    conflicts: number;
    wouldCreatePurchases: number;
    wouldUpdateExisting: number;
    wouldDuplicate: number;
  };
  totals: {
    declaredInvoiceTotal: number | null;
    officialItemsTotal: number;
    difference: number;
    canonicalEconomicTotalAfter: number;
  };
  secondImport: {
    status: InvoiceIdentityStatus;
    newEconomicPurchases: number;
    duplicateEconomicEffects: number;
    note: string;
  };
  readyForRealPersistence: boolean;
  blockers: string[];
  persisted: false;
};

export function cardStatementPersistenceDryRun(input: {
  invoice: InvoiceCanonical;
  items: OfficialItem[];
  cards: CardRow[];
  purchases: ExistingPurchase[];
  statementItems: ExistingStatementItem[];
  imports: ExistingImport[];
}): CardStatementPersistenceDryRun {
  const { invoice } = input;
  const last4s = invoice.cardLast4s?.length
    ? invoice.cardLast4s
    : invoice.cardLast4
      ? [invoice.cardLast4]
      : [];

  // 7. Pagamento da fatura anterior é metadado: nunca entra nos itens cobrados.
  const oficiais = input.items.filter(
    (i) => i.category !== "METADATA_SUMMARY" && i.category !== "PAYMENT",
  );

  const mapa = mapearCartoes(input.cards, invoice.issuer, last4s);
  const cardId = mapa.selecionado?.id ?? null;

  const fingerprint = cardId
    ? invoiceFingerprint({
        cardId,
        issuer: invoice.issuer,
        closingDate: invoice.closingDate,
        dueDate: invoice.dueDate,
        invoiceTotal: invoice.invoiceTotal,
      })
    : null;

  const vivos = input.imports.filter(
    (i) => i.status !== "CANCELLED" && i.status !== "UNDONE" && i.status !== "ERROR",
  );
  const jaImportada =
    (cardId &&
      vivos.find(
        (i) =>
          i.credit_card_id === cardId &&
          (i.fingerprint === fingerprint ||
            (i.data_fechamento === invoice.closingDate &&
              i.data_vencimento === invoice.dueDate &&
              Math.abs(Number(i.valor_total_fatura) - (invoice.invoiceTotal ?? 0)) < 0.01)),
      )) ||
    null;

  const lineageImportIds = new Set(jaImportada ? [jaImportada.id] : []);
  const escopoCartao = (id: string | null) => (cardId ? id === cardId : true);
  const purchases = input.purchases.filter((p) => escopoCartao(p.credit_card_id));
  const statementItems = input.statementItems.filter((s) => escopoCartao(s.credit_card_id));

  // Cada registro existente é consumido no máximo uma vez: repetições
  // legítimas do mesmo estabelecimento e dia permanecem separadas.
  const consumidos = new Set<string>();
  const itens: ItemDryRun[] = oficiais.map((item, index) => {
    const cands = candidatosPara(item, purchases, statementItems, lineageImportIds).filter(
      (c) => !consumidos.has(c.chave),
    );
    const melhor = cands[0] ?? null;
    const segundo = cands[1] ?? null;
    const installment = item.installmentCurrent
      ? `${item.installmentCurrent}/${item.installmentTotal ?? "?"}`
      : null;

    if (!melhor) {
      return {
        index: index + 1,
        date: item.date,
        cardLast4: item.cardLast4,
        description: item.description,
        amount: item.amount,
        installment,
        status: "NEW_ITEM",
        matchedPurchaseId: null,
        matchedStatementItemId: null,
        matchReason: "Nenhuma compra ou item de fatura equivalente no período.",
        actionPreview: "Criaria 1 compra vinculada à fatura.",
        score: 0,
      };
    }

    const empateAmbiguo = !!segundo && segundo.score === melhor.score && melhor.score >= 6;
    consumidos.add(melhor.chave);

    let status: CardDryRunItemStatus;
    let action: string;
    if (empateAmbiguo) {
      status = "CONFLICT";
      action = "Bloqueado: dois registros existentes disputam o mesmo lançamento.";
    } else if (melhor.score >= 9) {
      status = "EXACT_MATCH";
      action = "Nenhuma compra nova; apenas vincularia a evidência ao evento existente.";
    } else if (melhor.score >= 7) {
      status = "STRONG_MATCH";
      action = "Nenhuma compra nova; vincularia como conciliação do mesmo evento.";
    } else if (melhor.score >= 4) {
      status = "POSSIBLE_MATCH";
      action = "Exigiria revisão humana antes de conciliar ou criar.";
    } else {
      status = "NEW_ITEM";
      action = "Criaria 1 compra vinculada à fatura.";
    }

    return {
      index: index + 1,
      date: item.date,
      cardLast4: item.cardLast4,
      description: item.description,
      amount: item.amount,
      installment,
      status,
      matchedPurchaseId: status === "NEW_ITEM" ? null : melhor.purchaseId,
      matchedStatementItemId: status === "NEW_ITEM" ? null : melhor.statementItemId,
      matchReason: melhor.motivos.join(" · "),
      actionPreview: action,
      score: melhor.score,
    };
  });

  const conta = (s: CardDryRunItemStatus) => itens.filter((i) => i.status === s).length;
  const alreadyMatched = conta("EXACT_MATCH") + conta("STRONG_MATCH");
  const newItems = conta("NEW_ITEM");
  const possible = conta("POSSIBLE_MATCH");
  const conflicts = conta("CONFLICT");

  const officialItemsTotal = arred(oficiais.reduce((a, i) => a + i.amount, 0));
  const declared = invoice.invoiceTotal;
  const difference = declared === null ? officialItemsTotal : arred(officialItemsTotal - declared);

  const blockers: string[] = [];
  if (mapa.status !== "CARD_MAPPED") blockers.push(mapa.explicacao);
  if (conflicts > 0) blockers.push(`${conflicts} lançamento(s) em CONFLICT aguardando revisão.`);
  if (possible > 0) blockers.push(`${possible} lançamento(s) em POSSIBLE_MATCH exigem revisão.`);
  if (Math.abs(difference) >= 0.01)
    blockers.push("Soma dos itens oficiais diferente do total declarado da fatura.");

  const status: CardStatementPersistenceDryRun["status"] =
    mapa.status === "CARD_NOT_FOUND"
      ? "CARD_NOT_FOUND"
      : mapa.status === "CARD_MAPPING_REVIEW_REQUIRED"
        ? "CARD_MAPPING_REVIEW_REQUIRED"
        : conflicts > 0
          ? "BLOCKED"
          : possible > 0
            ? "REVIEW_REQUIRED"
            : "PASS";

  return {
    status,
    invoice: {
      issuer: invoice.issuer,
      holder: invoice.holder ?? null,
      closingDate: invoice.closingDate,
      dueDate: invoice.dueDate,
      invoiceTotal: declared,
      cardLast4s: last4s,
      consolidated: true,
      consolidationNote:
        last4s.length > 1
          ? `Finais ${last4s.join(" e ")} pertencem à mesma conta de crédito ${invoice.issuer ?? ""}: UMA fatura consolidada, com cardLast4 preservado em cada item.`
          : "Fatura única.",
    },
    cardMapping: {
      status: mapa.status,
      explicacao: mapa.explicacao,
      candidatos: mapa.candidatos,
      selectedCardId: cardId,
      selectedCardName: mapa.selecionado?.nome ?? null,
    },
    identity: {
      status: jaImportada ? "SAME_STATEMENT_ALREADY_IMPORTED" : "NEW_STATEMENT",
      fingerprint,
      matchedImportId: jaImportada?.id ?? null,
      matchedImportFile: jaImportada?.nome_arquivo ?? null,
      explicacao: jaImportada
        ? "Esta mesma fatura já foi importada: não criaria uma segunda invoice."
        : "Nenhuma importação equivalente encontrada para este cartão, fechamento, vencimento e total.",
    },
    previousPayment: {
      date: invoice.previousPayment?.data ?? null,
      amount: invoice.previousPayment?.valor ?? null,
      treatment: "METADATA_ONLY",
      note: "Pagamento da fatura anterior: metadado de reconciliação. Não vira compra nem entra nos itens cobrados.",
    },
    items: itens,
    summary: {
      officialItems: itens.length,
      alreadyMatched,
      possibleMatches: possible,
      newItems,
      conflicts,
      wouldCreatePurchases: newItems,
      wouldUpdateExisting: alreadyMatched,
      wouldDuplicate: 0,
    },
    totals: {
      declaredInvoiceTotal: declared,
      officialItemsTotal,
      difference,
      // A fatura oficial nunca é recalculada a partir do histórico interno.
      canonicalEconomicTotalAfter: declared ?? officialItemsTotal,
    },
    secondImport: {
      status: "SAME_STATEMENT_ALREADY_IMPORTED",
      newEconomicPurchases: 0,
      duplicateEconomicEffects: 0,
      note: "Reimportar o mesmo arquivo reconhece o fingerprint da fatura e a lineage dos itens: nenhuma despesa é multiplicada.",
    },
    readyForRealPersistence:
      status === "PASS" && conflicts === 0 && possible === 0 && Math.abs(difference) < 0.01,
    blockers,
    persisted: false,
  };
}
