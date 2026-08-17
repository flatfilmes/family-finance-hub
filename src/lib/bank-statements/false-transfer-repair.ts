/**
 * REMOÇÃO DE CONTRAPARTIDA DE TRANSFERÊNCIA FALSA — SOMENTE DRY RUN.
 *
 * Contexto: um pagamento de boleto lido no extrato do Banco do Brasil foi
 * registrado como TRANSFERÊNCIA INTERNA. Isso criou, na conta de destino,
 * uma ENTRADA que nunca existiu no PDF daquela conta — inflando o ledger.
 *
 * Este motor:
 *   1. localiza o par (origem real × contrapartida artificial) pelo
 *      `transfer_group_id` — nunca por data/valor soltos;
 *   2. prova, item a item, que a contrapartida não tem lastro no extrato
 *      importado da conta (nenhum `source_id`, nenhum `statement_item_id`,
 *      nenhuma linha equivalente do documento);
 *   3. simula a remoção e recalcula todos os checkpoints do banco.
 *
 * NADA aqui grava, apaga ou atualiza: é leitura pura. O plano reversível é
 * apenas descrito (`repairLog`) para execução posterior e explícita.
 */
import type { Transaction } from "@/lib/transactions";
import { movementEffect } from "@/lib/bank-ledger";
import type { BankStatementItemRow } from "@/lib/bank-statements/data";

export const FALSE_TRANSFER_REPAIR_TYPE = "REMOVE_FALSE_TRANSFER_COUNTERPART";

export type CheckStatus = "PASS" | "FAIL";

export type FalseTransferCheck = {
  id: string;
  label: string;
  status: CheckStatus;
  detail: string;
};

export type FalseTransferSide = {
  transactionId: string;
  accountId: string | null;
  accountLabel: string;
  data: string;
  valor: number;
  direcao: "IN" | "OUT" | "NEUTRO";
  descricao: string;
  sourceId: string | null;
  statementItemId: string | null;
  importId: string | null;
};

export type CheckpointSimulation = {
  data: string;
  tipo: string | null;
  rotulo: string | null;
  banco: number;
  calculadoAntes: number;
  calculadoDepois: number;
  diferencaAntes: number;
  diferencaDepois: number;
  confereDepois: boolean;
};

export type LedgerSnapshot = {
  movimentos: number;
  entradas: number;
  saidas: number;
  saldoCalculado: number;
};

export type FalseTransferRepairLog = {
  repair_type: typeof FALSE_TRANSFER_REPAIR_TYPE;
  bb_transaction_id: string | null;
  itau_transaction_id: string | null;
  transfer_group_id: string | null;
  amount: number | null;
  date: string | null;
  reason: string;
  executed_at: null;
  executed_by: null;
  reversible: true;
};

export type FalseTransferDryRun = {
  status: "READY" | "ABORT" | "ALREADY_REPAIRED" | "NOTHING_TO_DO";
  resumoStatus: string;
  documentoMovimentos: number;
  antes: LedgerSnapshot;
  depois: LedgerSnapshot;
  contrapartida: FalseTransferSide | null;
  origem: FalseTransferSide | null;
  transferGroupId: string | null;
  checks: FalseTransferCheck[];
  checkpoints: CheckpointSimulation[];
  residuais: CheckpointSimulation[];
  criterio: {
    documentoMovimentos: number;
    ledgerSimulado: number;
    contagemConfere: boolean;
    checkpointsConferem: boolean;
    aprovado: boolean;
  };
  repairLog: FalseTransferRepairLog | null;
};

const round = (v: number) => Math.round(v * 100) / 100;

type CheckpointInput = {
  data: string;
  saldo: number;
  rotulo?: string | null;
  tipo?: string | null;
};

type AccountInput = { id: string; banco?: string | null; nome_conta?: string | null };

function label(accounts: AccountInput[], id: string | null): string {
  const c = accounts.find((a) => a.id === id);
  if (!c) return "Conta não identificada";
  return [c.banco, c.nome_conta].filter(Boolean).join(" · ") || "Conta";
}

function side(t: Transaction, accounts: AccountInput[]): FalseTransferSide {
  const efeito = movementEffect(t);
  return {
    transactionId: t.id,
    accountId: t.bank_account_id,
    accountLabel: label(accounts, t.bank_account_id),
    data: t.data_movimento,
    valor: Math.abs(Number(t.valor) || 0),
    direcao: efeito > 0 ? "IN" : efeito < 0 ? "OUT" : "NEUTRO",
    descricao: t.descricao ?? "",
    sourceId: (t as { source_id?: string | null }).source_id ?? null,
    statementItemId: (t as { statement_item_id?: string | null }).statement_item_id ?? null,
    importId: null,
  };
}

function snapshot(transactions: Transaction[]): LedgerSnapshot {
  const efeitos = transactions.map(movementEffect);
  return {
    movimentos: transactions.filter((t) => t.tipo !== "ABERTURA_SALDO").length,
    entradas: round(efeitos.filter((e) => e > 0).reduce((a, e) => a + e, 0)),
    saidas: round(efeitos.filter((e) => e < 0).reduce((a, e) => a - e, 0)),
    saldoCalculado: round(efeitos.reduce((a, e) => a + e, 0)),
  };
}

function simularCheckpoints(
  antes: Transaction[],
  depois: Transaction[],
  checkpoints: CheckpointInput[],
): CheckpointSimulation[] {
  const acumulado = (lista: Transaction[], ate: string) =>
    round(lista.filter((t) => t.data_movimento <= ate).reduce((a, t) => a + movementEffect(t), 0));

  return checkpoints
    .filter((c) => (c.tipo ?? "DAILY") !== "REFERENCE")
    .slice()
    .sort((a, b) => a.data.localeCompare(b.data))
    .map((c) => {
      const calculadoAntes = acumulado(antes, c.data);
      const calculadoDepois = acumulado(depois, c.data);
      return {
        data: c.data,
        tipo: c.tipo ?? null,
        rotulo: c.rotulo ?? null,
        banco: round(c.saldo),
        calculadoAntes,
        calculadoDepois,
        diferencaAntes: round(calculadoAntes - c.saldo),
        diferencaDepois: round(calculadoDepois - c.saldo),
        confereDepois: round(calculadoDepois - c.saldo) === 0,
      };
    });
}

/**
 * Simula (sem gravar) a remoção da contrapartida artificial de transferência
 * na conta analisada. A perna real, na conta de origem, é sempre preservada.
 */
export function buildFalseTransferDryRun(input: {
  accountId: string;
  transactions: Transaction[];
  accounts: AccountInput[];
  checkpoints: CheckpointInput[];
  statementItems: BankStatementItemRow[];
}): FalseTransferDryRun {
  const daConta = input.transactions
    .filter((t) => t.bank_account_id === input.accountId && t.status !== "CANCELADA")
    .slice()
    .sort((a, b) => a.data_movimento.localeCompare(b.data_movimento));

  const documentoMovimentos = input.statementItems.filter((i) => i.incluir !== false).length;
  const antes = snapshot(daConta);

  // 1. IDENTIDADE: só transferências com grupo — nunca busca por data/valor.
  const candidatos = daConta.filter(
    (t) => t.tipo === "TRANSFERENCIA" && !!(t as { transfer_group_id?: string | null }).transfer_group_id,
  );

  const vazio = (status: FalseTransferDryRun["status"], resumo: string): FalseTransferDryRun => ({
    status,
    resumoStatus: resumo,
    documentoMovimentos,
    antes,
    depois: antes,
    contrapartida: null,
    origem: null,
    transferGroupId: null,
    checks: [],
    checkpoints: simularCheckpoints(daConta, daConta, input.checkpoints),
    residuais: simularCheckpoints(daConta, daConta, input.checkpoints).filter(
      (c) => !c.confereDepois,
    ),
    criterio: {
      documentoMovimentos,
      ledgerSimulado: antes.movimentos,
      contagemConfere: antes.movimentos === documentoMovimentos,
      checkpointsConferem: simularCheckpoints(daConta, daConta, input.checkpoints).every(
        (c) => c.confereDepois,
      ),
      aprovado: false,
    },
    repairLog: null,
  });

  if (!candidatos.length) {
    return vazio(
      antes.movimentos === documentoMovimentos ? "ALREADY_REPAIRED" : "NOTHING_TO_DO",
      antes.movimentos === documentoMovimentos
        ? "Nenhuma contrapartida de transferência nesta conta — o ledger já bate com o documento."
        : "Nenhuma transferência com grupo nesta conta. A divergência tem outra causa.",
    );
  }

  // Escolhe o candidato sem qualquer lastro documental.
  const semLastro = candidatos.filter((t) => {
    const sourceId = (t as { source_id?: string | null }).source_id ?? null;
    const itemId = (t as { statement_item_id?: string | null }).statement_item_id ?? null;
    const casaComItem = input.statementItems.some(
      (i) =>
        i.transaction_id_criada === t.id ||
        i.transaction_id_matched === t.id ||
        (i.data_movimento === t.data_movimento &&
          Math.abs(Number(i.valor) || 0) === Math.abs(Number(t.valor) || 0)),
    );
    return !sourceId && !itemId && !casaComItem;
  });

  const alvo = semLastro[0] ?? null;
  if (!alvo) {
    return vazio(
      "ALREADY_REPAIRED",
      "As transferências desta conta têm lastro no extrato importado — nada a remover.",
    );
  }

  const groupId = (alvo as { transfer_group_id?: string | null }).transfer_group_id ?? null;
  const perna = input.transactions.find(
    (t) =>
      t.id !== alvo.id &&
      (t as { transfer_group_id?: string | null }).transfer_group_id === groupId &&
      t.status !== "CANCELADA",
  );

  const contrapartida = side(alvo, input.accounts);
  const origem = perna ? side(perna, input.accounts) : null;

  // 2. PROVAS — qualquer FAIL aborta o plano.
  const checks: FalseTransferCheck[] = [
    {
      id: "GRUPO",
      label: "Par identificado pelo transfer_group_id (nunca por data/valor)",
      status: groupId && origem ? "PASS" : "FAIL",
      detail: groupId
        ? `Grupo ${groupId}${origem ? ` · perna real em ${origem.accountLabel}` : " · perna real não encontrada"}`
        : "Transação sem grupo de transferência.",
    },
    {
      id: "SEM_SOURCE_ID",
      label: "Não existe em nenhum sourceId do extrato desta conta",
      status: contrapartida.sourceId ? "FAIL" : "PASS",
      detail: contrapartida.sourceId
        ? `Possui source_id ${contrapartida.sourceId} — tem lastro documental.`
        : "Nenhum source_id: não veio de linha lida do PDF.",
    },
    {
      id: "SEM_ITEM",
      label: "Não corresponde a nenhum item do extrato importado",
      status: input.statementItems.some(
        (i) => i.transaction_id_criada === alvo.id || i.transaction_id_matched === alvo.id,
      )
        ? "FAIL"
        : "PASS",
      detail: "Nenhum bank_statement_item aponta para esta transação.",
    },
    {
      id: "SEM_LINHA_PDF",
      label: "Nenhuma linha do PDF com a mesma data e valor",
      status: input.statementItems.some(
        (i) =>
          i.data_movimento === alvo.data_movimento &&
          Math.abs(Number(i.valor) || 0) === Math.abs(Number(alvo.valor) || 0),
      )
        ? "FAIL"
        : "PASS",
      detail: `Documento não contém ${contrapartida.data} · ${contrapartida.valor.toFixed(2)}.`,
    },
    {
      id: "ORIGEM_LEGITIMA",
      label: "A perna de origem é real e permanece intocada",
      status: origem && origem.accountId !== input.accountId ? "PASS" : "FAIL",
      detail: origem
        ? `${origem.accountLabel} · ${origem.direcao} ${origem.valor.toFixed(2)} em ${origem.data} — preservada.`
        : "Perna de origem ausente: sem par, a remoção não é segura.",
    },
    {
      id: "CRIADA_POR_TRANSFERENCIA",
      label: "Foi criada por transfer_between_accounts",
      status: alvo.tipo === "TRANSFERENCIA" && !alvo.manual ? "PASS" : "FAIL",
      detail: alvo.manual
        ? "Transação marcada como manual — não é contrapartida automática."
        : "Tipo TRANSFERENCIA, não manual, com par no mesmo grupo.",
    },
  ];

  const abortar = checks.some((c) => c.status === "FAIL");
  const restante = daConta.filter((t) => t.id !== alvo.id);
  const depois = snapshot(restante);
  const checkpoints = simularCheckpoints(daConta, restante, input.checkpoints);
  const residuais = checkpoints.filter((c) => !c.confereDepois);

  const contagemConfere = depois.movimentos === documentoMovimentos;
  const checkpointsConferem = residuais.length === 0;

  return {
    status: abortar ? "ABORT" : "READY",
    resumoStatus: abortar
      ? "Plano abortado: a contrapartida não passou em todas as provas de identidade."
      : contagemConfere && checkpointsConferem
        ? "Dry run aprovado: remover a contrapartida zera todas as diferenças."
        : "Dry run concluído com ressalvas: a remoção corrige a maior parte, mas sobra divergência.",
    documentoMovimentos,
    antes,
    depois,
    contrapartida,
    origem,
    transferGroupId: groupId,
    checks,
    checkpoints,
    residuais,
    criterio: {
      documentoMovimentos,
      ledgerSimulado: depois.movimentos,
      contagemConfere,
      checkpointsConferem,
      aprovado: !abortar && contagemConfere && checkpointsConferem,
    },
    repairLog: abortar
      ? null
      : {
          repair_type: FALSE_TRANSFER_REPAIR_TYPE,
          bb_transaction_id: origem?.transactionId ?? null,
          itau_transaction_id: contrapartida.transactionId,
          transfer_group_id: groupId,
          amount: contrapartida.valor,
          date: contrapartida.data,
          reason:
            "Contrapartida criada por transferência interna falsa: pagamento de boleto lido no extrato de origem não corresponde a nenhuma linha do extrato da conta de destino.",
          executed_at: null,
          executed_by: null,
          reversible: true,
        },
  };
}
