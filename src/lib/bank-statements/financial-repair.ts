/**
 * FINANCIAL_REPAIR_DRY_RUN — REPARO FINANCEIRO SIMULADO, SOMENTE LEITURA.
 *
 * O extrato canônico (ParsedBankStatement validado) é a fonte da verdade. Este
 * motor compara o ledger contra ele e descreve — sem executar nada — as três
 * classes de correção necessárias:
 *
 *   1. REMOVE_CANDIDATE            entrada artificial no ledger sem lastro no PDF
 *                                  (contrapartida de transferência interna falsa);
 *   2. CORRECT_DIRECTION_CANDIDATE linha do PDF persistida com o sentido invertido
 *                                  (o documento diz +0,03 e o ledger gravou −0,03);
 *   3. nada mais: nenhuma linha oficial do documento é excluída.
 *
 * Também resolve a leitura do auditor quando o MESMO extrato foi importado duas
 * vezes: os imports de período idêntico viram SAME_PERIOD_OVERLAP e apenas o
 * canônico conta checkpoints e continuidade.
 *
 * NENHUMA linha deste arquivo grava, apaga ou atualiza dados. Sem DELETE, sem
 * UPDATE, sem alteração de transfer_group, sem persistir a seleção canônica.
 */
import { movementEffect } from "@/lib/bank-ledger";
import type { Transaction } from "@/lib/transactions";
import type { BankStatementItemRow } from "./data";
import {
  buildStatementSelection,
  type SelectionImportInput,
  type StatementSelection,
} from "./statement-selection";

export const FINANCIAL_REPAIR_DRY_RUN = "FINANCIAL_REPAIR_DRY_RUN";

const round = (v: number) => Math.round(v * 100) / 100;
const TOLERANCIA = 0.005;

export type RepairAction = "REMOVE_CANDIDATE" | "CORRECT_DIRECTION_CANDIDATE";

export type RepairCandidate = {
  acao: RepairAction;
  transactionId: string;
  accountId: string | null;
  accountLabel: string;
  data: string;
  valor: number;
  direcaoAtual: "IN" | "OUT" | "NEUTRO";
  direcaoCorreta: "IN" | "OUT" | null;
  descricao: string;
  sourceId: string | null;
  statementItemId: string | null;
  importId: string | null;
  transferGroupId: string | null;
  createdAt: string | null;
  tipo: string;
  origem: string;
  /** Efeito no saldo simulado quando a correção é aplicada. */
  efeitoSaldo: number;
  provas: { id: string; label: string; status: "PASS" | "FAIL"; detail: string }[];
  /** Perna legítima preservada, quando o candidato é contrapartida de transferência. */
  contraparte: {
    transactionId: string;
    accountId: string | null;
    accountLabel: string;
    data: string;
    valor: number;
    direcao: "IN" | "OUT" | "NEUTRO";
    descricao: string;
  } | null;
};

export type RepairCheckpointSim = {
  data: string;
  tipo: string | null;
  banco: number;
  calculadoAntes: number;
  calculadoDepois: number;
  diferencaAntes: number;
  diferencaDepois: number;
  confereDepois: boolean;
};

export type FinancialRepairDryRun = {
  tipo: typeof FINANCIAL_REPAIR_DRY_RUN;
  dryRun: true;
  executadoEm: string;
  accountId: string;
  canonico: {
    importId: string | null;
    periodStart: string | null;
    periodEnd: string | null;
    openingDate: string | null;
    openingBalance: number | null;
    closingBalance: number | null;
    transacoesDocumento: number;
    checkpointsCanonicos: number;
  };
  selecao: StatementSelection;
  candidatos: RepairCandidate[];
  remocoes: RepairCandidate[];
  inversoes: RepairCandidate[];
  ledger: { antes: number; depois: number; documento: number; confere: boolean };
  saldo: { antes: number; depois: number; alvo: number | null; residual: number };
  checkpoints: RepairCheckpointSim[];
  checkpointsResumo: { total: number; conferem: number; ok: boolean };
  aprovado: boolean;
  resumo: string;
};

type AccountInput = { id: string; banco?: string | null; nome_conta?: string | null };

function label(accounts: AccountInput[], id: string | null): string {
  const c = accounts.find((a) => a.id === id);
  if (!c) return "Conta não identificada";
  return [c.banco, c.nome_conta].filter(Boolean).join(" · ") || "Conta";
}

const dir = (efeito: number): "IN" | "OUT" | "NEUTRO" =>
  efeito > 0 ? "IN" : efeito < 0 ? "OUT" : "NEUTRO";

export function buildFinancialRepairDryRun(input: {
  accountId: string;
  transactions: Transaction[];
  accounts: AccountInput[];
  imports: SelectionImportInput[];
  checkpoints: { data: string; saldo: number; tipo?: string | null; importId?: string | null }[];
  statementItems: BankStatementItemRow[];
}): FinancialRepairDryRun {
  // ---------- 1. extrato canônico ----------
  const selecao = buildStatementSelection({
    imports: input.imports,
    checkpoints: input.checkpoints,
    statementItems: input.statementItems,
  });
  const grupoCanonico =
    selecao.grupos.find((g) => g.relacao === "SAME_PERIOD_OVERLAP") ?? selecao.grupos[0] ?? null;
  const canonico = grupoCanonico?.candidatos.find((c) => c.canonical) ?? null;
  const canonicalId = canonico?.importId ?? null;

  const itensCanonicos = input.statementItems.filter(
    (i) => (!canonicalId || i.import_id === canonicalId) && i.incluir !== false,
  );
  const documentoMovimentos = itensCanonicos.length;

  const checkpointsCanonicos = input.checkpoints
    .filter((c) => (c.tipo ?? "DAILY") === "DAILY")
    .filter((c) => !canonicalId || !c.importId || c.importId === canonicalId)
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data));

  // ---------- 2. ledger atual ----------
  const daConta = input.transactions
    .filter((t) => t.bank_account_id === input.accountId && t.status !== "CANCELADA")
    .slice()
    .sort((a, b) => a.data_movimento.localeCompare(b.data_movimento));

  const contarMovimentos = (lista: Transaction[]) =>
    lista.filter((t) => t.tipo !== "ABERTURA_SALDO").length;

  const itemPorTransacao = new Map<string, BankStatementItemRow>();
  for (const i of itensCanonicos) {
    const id = i.transaction_id_criada ?? i.transaction_id_matched;
    if (id && !itemPorTransacao.has(id)) itemPorTransacao.set(id, i);
  }
  const qualquerItemAponta = (id: string) =>
    input.statementItems.some(
      (i) => i.transaction_id_criada === id || i.transaction_id_matched === id,
    );

  const candidatos: RepairCandidate[] = [];

  // ---------- 3. entradas artificiais (sem lastro no documento) ----------
  for (const t of daConta) {
    if (t.tipo !== "TRANSFERENCIA") continue;
    const grupo = (t as { transfer_group_id?: string | null }).transfer_group_id ?? null;
    const sourceId = (t as { source_id?: string | null }).source_id ?? null;
    const itemId = (t as { statement_item_id?: string | null }).statement_item_id ?? null;
    const valor = Math.abs(Number(t.valor) || 0);
    const efeito = movementEffect(t);

    const linhaEquivalente = itensCanonicos.some(
      (i) =>
        i.data_movimento === t.data_movimento &&
        Math.abs(Math.abs(Number(i.valor) || 0) - valor) <= TOLERANCIA,
    );
    if (sourceId || itemId || qualquerItemAponta(t.id) || linhaEquivalente) continue;

    const perna = input.transactions.find(
      (o) =>
        o.id !== t.id &&
        !!grupo &&
        (o as { transfer_group_id?: string | null }).transfer_group_id === grupo &&
        o.status !== "CANCELADA",
    );

    candidatos.push({
      acao: "REMOVE_CANDIDATE",
      transactionId: t.id,
      accountId: t.bank_account_id,
      accountLabel: label(input.accounts, t.bank_account_id),
      data: t.data_movimento,
      valor,
      direcaoAtual: dir(efeito),
      direcaoCorreta: null,
      descricao: t.descricao ?? "",
      sourceId,
      statementItemId: itemId,
      importId: null,
      transferGroupId: grupo,
      createdAt: (t.created_at as string | null) ?? null,
      tipo: t.tipo,
      origem: "transfer_between_accounts (contrapartida interna)",
      efeitoSaldo: round(-efeito),
      provas: [
        {
          id: "SEM_SOURCE_ID",
          label: "Não possui source_id do extrato desta conta",
          status: sourceId ? "FAIL" : "PASS",
          detail: sourceId ? `source_id ${sourceId}` : "Nenhum source_id: não nasceu do PDF.",
        },
        {
          id: "SEM_STATEMENT_ITEM",
          label: "Nenhum bank_statement_item aponta para esta transação",
          status: qualquerItemAponta(t.id) ? "FAIL" : "PASS",
          detail: "Nenhuma linha importada foi vinculada a este movimento.",
        },
        {
          id: "SEM_LINHA_NO_PDF",
          label: "Nenhuma linha do extrato canônico com a mesma data e valor",
          status: linhaEquivalente ? "FAIL" : "PASS",
          detail: `Documento não contém ${t.data_movimento} · ${valor.toFixed(2)}.`,
        },
        {
          id: "PAR_POR_GRUPO",
          label: "Par localizado pelo transfer_group_id (nunca por data/valor)",
          status: grupo && perna ? "PASS" : "FAIL",
          detail: grupo
            ? `Grupo ${grupo}${perna ? " · perna real preservada" : " · perna real não encontrada"}`
            : "Sem grupo de transferência.",
        },
        {
          id: "ORIGEM_PRESERVADA",
          label: "A saída original em outra conta NÃO é removida",
          status: perna && perna.bank_account_id !== input.accountId ? "PASS" : "FAIL",
          detail: perna
            ? `${label(input.accounts, perna.bank_account_id)} · ${dir(movementEffect(perna))} ${Math.abs(Number(perna.valor) || 0).toFixed(2)} em ${perna.data_movimento} — intocada.`
            : "Perna de origem ausente.",
        },
      ],
      contraparte: perna
        ? {
            transactionId: perna.id,
            accountId: perna.bank_account_id,
            accountLabel: label(input.accounts, perna.bank_account_id),
            data: perna.data_movimento,
            valor: Math.abs(Number(perna.valor) || 0),
            direcao: dir(movementEffect(perna)),
            descricao: perna.descricao ?? "",
          }
        : null,
    });
  }

  // ---------- 4. sentido invertido em relação ao documento ----------
  for (const t of daConta) {
    if (t.tipo === "ABERTURA_SALDO") continue;
    const item = itemPorTransacao.get(t.id);
    if (!item) continue;
    const valorDoc = Number(item.valor) || 0;
    if (Math.abs(valorDoc) <= TOLERANCIA) continue;
    const efeito = movementEffect(t);
    if (efeito === 0) continue;
    if (Math.sign(valorDoc) === Math.sign(efeito)) continue;
    if (Math.abs(Math.abs(valorDoc) - Math.abs(efeito)) > TOLERANCIA) continue;

    candidatos.push({
      acao: "CORRECT_DIRECTION_CANDIDATE",
      transactionId: t.id,
      accountId: t.bank_account_id,
      accountLabel: label(input.accounts, t.bank_account_id),
      data: t.data_movimento,
      valor: Math.abs(valorDoc),
      direcaoAtual: dir(efeito),
      direcaoCorreta: valorDoc > 0 ? "IN" : "OUT",
      descricao: t.descricao ?? item.descricao_original ?? "",
      sourceId: item.source_id ?? null,
      statementItemId: item.id,
      importId: item.import_id,
      transferGroupId: (t as { transfer_group_id?: string | null }).transfer_group_id ?? null,
      createdAt: (t.created_at as string | null) ?? null,
      tipo: t.tipo,
      origem: "linha do extrato canônico persistida com sinal invertido",
      efeitoSaldo: round(-2 * efeito),
      provas: [
        {
          id: "LINHA_DO_DOCUMENTO",
          label: "Existe linha correspondente no extrato canônico",
          status: "PASS",
          detail: `${item.data_movimento} · "${item.descricao_original}" · ${valorDoc.toFixed(2)} · sourceId ${item.source_id ?? "—"}`,
        },
        {
          id: "MESMO_VALOR",
          label: "Mesmo valor absoluto — só o sentido diverge",
          status: "PASS",
          detail: `Documento ${valorDoc > 0 ? "+" : "−"}${Math.abs(valorDoc).toFixed(2)} × ledger ${dir(efeito)} ${Math.abs(efeito).toFixed(2)}.`,
        },
        {
          id: "NAO_REMOVE",
          label: "Movimento oficial do PDF é mantido (apenas o sentido muda)",
          status: "PASS",
          detail: "Nenhuma linha do documento é excluída por esta correção.",
        },
      ],
      contraparte: null,
    });
  }

  // ---------- 5. simulação financeira ----------
  const remover = new Set(
    candidatos.filter((c) => c.acao === "REMOVE_CANDIDATE").map((c) => c.transactionId),
  );
  const inverter = new Set(
    candidatos
      .filter((c) => c.acao === "CORRECT_DIRECTION_CANDIDATE")
      .map((c) => c.transactionId),
  );
  const efeitoDepois = (t: Transaction) => {
    if (remover.has(t.id)) return 0;
    const e = movementEffect(t);
    return inverter.has(t.id) ? -e : e;
  };

  const saldoAntes = round(daConta.reduce((a, t) => a + movementEffect(t), 0));
  const saldoDepois = round(daConta.reduce((a, t) => a + efeitoDepois(t), 0));
  const ledgerDepois = contarMovimentos(daConta.filter((t) => !remover.has(t.id)));

  const acumulado = (ate: string, depois: boolean) =>
    round(
      daConta
        .filter((t) => t.data_movimento <= ate)
        .reduce((a, t) => a + (depois ? efeitoDepois(t) : movementEffect(t)), 0),
    );

  const checkpoints: RepairCheckpointSim[] = checkpointsCanonicos.map((c) => {
    const antes = acumulado(c.data, false);
    const depois = acumulado(c.data, true);
    return {
      data: c.data,
      tipo: c.tipo ?? null,
      banco: round(c.saldo),
      calculadoAntes: antes,
      calculadoDepois: depois,
      diferencaAntes: round(antes - c.saldo),
      diferencaDepois: round(depois - c.saldo),
      confereDepois: Math.abs(round(depois - c.saldo)) <= TOLERANCIA,
    };
  });

  const conferem = checkpoints.filter((c) => c.confereDepois).length;
  const alvo = canonico?.closingBalance ?? null;
  const residual = alvo === null ? 0 : round(saldoDepois - alvo);
  const ledgerConfere = ledgerDepois === documentoMovimentos;
  const checkpointsOk = checkpoints.length > 0 && conferem === checkpoints.length;
  const provasOk = candidatos.every((c) => c.provas.every((p) => p.status === "PASS"));
  const aprovado = provasOk && ledgerConfere && checkpointsOk && Math.abs(residual) <= TOLERANCIA;

  return {
    tipo: FINANCIAL_REPAIR_DRY_RUN,
    dryRun: true,
    executadoEm: new Date().toISOString(),
    accountId: input.accountId,
    canonico: {
      importId: canonicalId,
      periodStart: canonico?.periodStart ?? null,
      periodEnd: canonico?.periodEnd ?? null,
      openingDate: canonico?.openingDate ?? null,
      openingBalance: canonico?.openingBalance ?? null,
      closingBalance: alvo,
      transacoesDocumento: documentoMovimentos,
      checkpointsCanonicos: checkpoints.length,
    },
    selecao,
    candidatos,
    remocoes: candidatos.filter((c) => c.acao === "REMOVE_CANDIDATE"),
    inversoes: candidatos.filter((c) => c.acao === "CORRECT_DIRECTION_CANDIDATE"),
    ledger: {
      antes: contarMovimentos(daConta),
      depois: ledgerDepois,
      documento: documentoMovimentos,
      confere: ledgerConfere,
    },
    saldo: { antes: saldoAntes, depois: saldoDepois, alvo, residual },
    checkpoints,
    checkpointsResumo: { total: checkpoints.length, conferem, ok: checkpointsOk },
    aprovado,
    resumo: !candidatos.length
      ? "Nenhum reparo necessário: o ledger já corresponde ao extrato canônico."
      : aprovado
        ? `Simulação aprovada: ${candidatos.length} correção(ões) levam o ledger a ${documentoMovimentos} movimentos e todos os checkpoints a diferença 0.`
        : "Simulação concluída com ressalvas: as correções não zeram todas as diferenças.",
  };
}
