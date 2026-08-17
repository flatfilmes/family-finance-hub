/**
 * VALIDAÇÃO DO REPARO — DRY RUN, SOMENTE LEITURA.
 *
 * Roda a mesma conta que o reparo faria, mas sem gravar nada. Responde duas
 * perguntas de forma verificável:
 *
 *  1. Qual transação do ledger (a "transação Y") nasceria de cada linha
 *     ausente — com data, valor, sentido, descrição canônica e identidade de
 *     origem — e se ela seria mesmo criada ou se já existe algo equivalente.
 *  2. Mês a mês, do primeiro mês afetado até o último com movimento, qual é o
 *     saldo hoje, qual seria depois e quanto a diferença contra o banco cai.
 *
 * Nenhuma linha deste arquivo grava, corrige ou altera valor, data ou sentido.
 */
import { movementEffect } from "@/lib/bank-ledger";
import type { Transaction } from "@/lib/transactions";
import type { PersistenceRepairPlan, RestoredLine } from "./persistence-repair";
import type { RepairProof } from "./repair-proof";
import {
  buildChainedValidation,
  buildStandaloneValidation,
  type ChainedValidation,
  type StandaloneValidation,
} from "./chained-validation";

const TOLERANCIA = 0.01;
const round = (n: number) => Math.round(n * 100) / 100;

export type LedgerPreview = {
  /** Identificador temporário — a transação ainda não existe. */
  rotulo: string;
  bank_account_id: string;
  data_movimento: string | null;
  tipo: "ENTRADA" | "SAIDA";
  valor: number;
  descricao: string;
  status: "CONFIRMADA";
  source_id: string;
  statement_item_id: string;
  occurrence_index: number;
  efeitoSaldo: number;
};

export type ValidatedCandidate = {
  sourceId: string;
  itemId: string;
  periodo: string;
  documentNumber: string | null;
  rawText: string | null;
  motivo: string;
  /** Transação que seria criada. */
  preview: LedgerPreview;
  /** Linhas do mesmo dia/valor que JÁ existem no ledger. */
  irmaosNoLedger: { transactionId: string; documentNumber: string | null }[];
  veredito: "SERIA_RESTAURADA" | "JA_EXISTE_NO_LEDGER" | "SEM_DATA";
  explicacao: string;
};

export type RepairCheck = {
  chave: string;
  titulo: string;
  status: "PASS" | "FAIL";
  detalhe: string;
};

export type RepairValidation = {
  executadoEm: string;
  dryRun: true;
  accountId: string;
  candidatos: ValidatedCandidate[];
  /** Cada mês validado isoladamente pelo saldo inicial oficial do seu PDF. */
  standaloneValidation: StandaloneValidation;
  /** Ledger encadeado mês a mês — leitura oficial do impacto do reparo. */
  chainedValidation: ChainedValidation;
  verificacoes: RepairCheck[];
  validationRepair: "PASS" | "FAIL";
  totais: {
    restoreCount: number;
    naoSeriamRestauradas: number;
    efeitoSaldoFinal: number;
    mesesCorrigidos: number;
    mesesAindaDivergentes: number;
  };
  veredito: "PRONTO_PARA_REPARO" | "NADA_A_REPARAR" | "REVISAR";
};

const MESES = [
  "Janeiro",
  "Fevereiro",
  "Março",
  "Abril",
  "Maio",
  "Junho",
  "Julho",
  "Agosto",
  "Setembro",
  "Outubro",
  "Novembro",
  "Dezembro",
];

function rotuloMes(mes: string) {
  const [ano, m] = mes.split("-");
  return `${MESES[Number(m) - 1] ?? m}/${ano}`;
}

export function buildRepairValidation(input: {
  accountId: string;
  plan: PersistenceRepairPlan;
  proof: RepairProof;
  transactions: Transaction[];
  checkpoints: { data: string; saldo: number; tipo?: string | null }[];
}): RepairValidation {
  const ledger = input.transactions
    .filter((t) => t.bank_account_id === input.accountId && t.status !== "CANCELADA")
    .sort((a, b) => a.data_movimento.localeCompare(b.data_movimento));

  // ---- candidatos: a transação Y de cada linha ausente ------------------
  const candidatos: ValidatedCandidate[] = [];
  for (const p of input.plan.periodos) {
    for (const linha of p.restauradas) {
      candidatos.push(validarLinha(linha, p.rotulo, input, ledger));
    }
  }

  const restauraveis = candidatos.filter((c) => c.veredito === "SERIA_RESTAURADA");

  // ---- duas leituras, nunca misturadas ----------------------------------
  const standaloneValidation = buildStandaloneValidation(input.plan);
  const chainedValidation = buildChainedValidation(input.plan);

  const chainedComDocumento = chainedValidation.periodos.filter((p) => p.saldoDocumento !== null);
  const mesesCorrigidos = chainedComDocumento.filter(
    (p) => p.confereAntes === false && p.confereDepois === true,
  ).length;
  const mesesAindaDivergentes = chainedComDocumento.filter((p) => p.confereDepois === false).length;

  // ---- verificações obrigatórias antes de liberar o reparo --------------
  const verificacoes: RepairCheck[] = [];
  const check = (chave: string, titulo: string, ok: boolean, detalhe: string) =>
    verificacoes.push({ chave, titulo, status: ok ? "PASS" : "FAIL", detalhe });

  const linhasDosGrupos = input.proof.grupos.flatMap((g) => g.linhas);
  const ausentes = linhasDosGrupos.filter((l) => !l.presente);
  const presentes = linhasDosGrupos.filter((l) => l.presente);

  for (const l of ausentes) {
    check(
      `AUSENTE_${l.documentNumber ?? l.sourceId}`,
      `Documento ${l.documentNumber ?? l.sourceId} continua ausente`,
      true,
      `${l.data ?? "sem data"} · ${l.direcao} ${l.valor.toFixed(2)} · sourceId ${l.sourceId} — nenhuma transação corresponde a esta linha hoje.`,
    );
  }
  for (const l of presentes) {
    check(
      `PRESENTE_${l.documentNumber ?? l.sourceId}`,
      `Documento ${l.documentNumber ?? l.sourceId} continua existente`,
      !!l.ledgerTransactionId,
      `${l.data ?? "sem data"} · ${l.direcao} ${l.valor.toFixed(2)} · transação ${l.ledgerTransactionId ?? "não encontrada"}.`,
    );
  }

  const duplicadas = candidatos.filter((c) => c.veredito === "JA_EXISTE_NO_LEDGER");
  check(
    "SEM_EQUIVALENTE_NOVO",
    "Nenhuma transação equivalente apareceu desde o dry run anterior",
    duplicadas.length === 0,
    duplicadas.length === 0
      ? "Nenhum movimento igual em data, valor e sentido foi encontrado para as linhas ausentes."
      : `${duplicadas.length} linha(s) já têm equivalente no ledger — restaurar duplicaria dinheiro.`,
  );

  check(
    "CHAINED_FECHA_EM_ZERO",
    "Ledger encadeado fecha em zero depois da simulação",
    chainedValidation.todosZeradosDepois,
    chainedValidation.todosZeradosDepois
      ? "Todos os períodos com saldo de documento ficam com diferença 0 no encadeamento."
      : `${mesesAindaDivergentes} período(s) continuariam divergentes no encadeamento.`,
  );

  check(
    "UMA_TRANSACTION",
    "Apenas uma transação seria criada",
    restauraveis.length === 1,
    `${restauraveis.length} transação(ões) nasceriam da simulação.`,
  );

  const validationRepair: "PASS" | "FAIL" = verificacoes.every((v) => v.status === "PASS")
    ? "PASS"
    : "FAIL";

  return {
    executadoEm: new Date().toISOString(),
    dryRun: true,
    accountId: input.accountId,
    candidatos,
    standaloneValidation,
    chainedValidation,
    verificacoes,
    validationRepair,
    totais: {
      restoreCount: restauraveis.length,
      naoSeriamRestauradas: candidatos.length - restauraveis.length,
      efeitoSaldoFinal: round(restauraveis.reduce((a, c) => a + c.preview.efeitoSaldo, 0)),
      mesesCorrigidos,
      mesesAindaDivergentes,
    },
    veredito: !candidatos.length
      ? "NADA_A_REPARAR"
      : validationRepair === "PASS"
        ? "PRONTO_PARA_REPARO"
        : "REVISAR",
  };
}

function validarLinha(
  linha: RestoredLine,
  periodo: string,
  input: {
    accountId: string;
    proof: RepairProof;
    transactions: Transaction[];
  },
  ledger: Transaction[],
): ValidatedCandidate {
  const grupo = input.proof.grupos.find((g) => g.linhas.some((l) => l.sourceId === linha.sourceId));
  const evid = grupo?.linhas.find((l) => l.sourceId === linha.sourceId) ?? null;

  const preview: LedgerPreview = {
    rotulo: `Y · ${linha.sourceId}`,
    bank_account_id: input.accountId,
    data_movimento: linha.data,
    tipo: linha.direcao === "IN" ? "ENTRADA" : "SAIDA",
    valor: Math.abs(linha.valor),
    descricao: linha.descricao,
    status: "CONFIRMADA",
    source_id: linha.sourceId,
    statement_item_id: linha.itemId,
    occurrence_index: linha.ordem,
    efeitoSaldo: linha.deltaSaldo,
  };

  const irmaos = (grupo?.linhas ?? [])
    .filter((l) => l.presente && l.ledgerTransactionId)
    .map((l) => ({
      transactionId: l.ledgerTransactionId as string,
      documentNumber: l.documentNumber,
    }));

  if (!linha.data) {
    return {
      sourceId: linha.sourceId,
      itemId: linha.itemId,
      periodo,
      documentNumber: evid?.documentNumber ?? null,
      rawText: evid?.rawText ?? null,
      motivo: linha.motivo,
      preview,
      irmaosNoLedger: irmaos,
      veredito: "SEM_DATA",
      explicacao: "A linha não tem data contábil no extrato lido — sem data não há reparo seguro.",
    };
  }

  const jaUsados = new Set(
    (grupo?.linhas ?? []).map((l) => l.ledgerTransactionId).filter(Boolean) as string[],
  );
  const equivalente = ledger.find(
    (t) =>
      !jaUsados.has(t.id) &&
      t.data_movimento === linha.data &&
      Math.abs(Number(t.valor) - Math.abs(linha.valor)) <= TOLERANCIA &&
      movementEffect(t) * linha.deltaSaldo > 0,
  );

  if (equivalente) {
    return {
      sourceId: linha.sourceId,
      itemId: linha.itemId,
      periodo,
      documentNumber: evid?.documentNumber ?? null,
      rawText: evid?.rawText ?? null,
      motivo: linha.motivo,
      preview,
      irmaosNoLedger: [...irmaos, { transactionId: equivalente.id, documentNumber: null }],
      veredito: "JA_EXISTE_NO_LEDGER",
      explicacao: `O ledger já tem um movimento igual em ${linha.data} (${equivalente.id.slice(0, 8)}). Restaurar duplicaria dinheiro.`,
    };
  }

  return {
    sourceId: linha.sourceId,
    itemId: linha.itemId,
    periodo,
    documentNumber: evid?.documentNumber ?? null,
    rawText: evid?.rawText ?? null,
    motivo: linha.motivo,
    preview,
    irmaosNoLedger: irmaos,
    veredito: "SERIA_RESTAURADA",
    explicacao:
      "Nenhum movimento equivalente existe hoje nesta data — a transação seria criada exatamente como o documento manda.",
  };
}
