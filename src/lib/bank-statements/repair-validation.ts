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

export type MonthDiff = {
  mes: string;
  rotulo: string;
  movimentosAntes: number;
  movimentosDepois: number;
  saldoAntes: number;
  saldoDepois: number;
  delta: number;
  saldoBanco: number | null;
  diferencaAntes: number | null;
  diferencaDepois: number | null;
  confereAntes: boolean | null;
  confereDepois: boolean | null;
};

export type RepairValidation = {
  executadoEm: string;
  dryRun: true;
  accountId: string;
  candidatos: ValidatedCandidate[];
  meses: MonthDiff[];
  totais: {
    seriamRestauradas: number;
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

  // ---- diff de saldos mês a mês -----------------------------------------
  const eventos = ledger
    .map((t) => ({ data: t.data_movimento, efeito: movementEffect(t), extra: false }))
    .concat(
      restauraveis
        .filter((c) => !!c.preview.data_movimento)
        .map((c) => ({
          data: c.preview.data_movimento as string,
          efeito: c.preview.efeitoSaldo,
          extra: true,
        })),
    )
    .sort((a, b) => a.data.localeCompare(b.data));

  const primeiroMesAfetado = restauraveis
    .map((c) => c.preview.data_movimento)
    .filter((d): d is string => !!d)
    .sort()[0]
    ?.slice(0, 7);

  const porMes = new Map<
    string,
    { antes: number; depois: number; movAntes: number; movDepois: number }
  >();
  let saldoAntes = 0;
  let saldoDepois = 0;
  for (const e of eventos) {
    const mes = e.data.slice(0, 7);
    if (!e.extra) saldoAntes = round(saldoAntes + e.efeito);
    saldoDepois = round(saldoDepois + e.efeito);
    const atual = porMes.get(mes) ?? { antes: saldoAntes, depois: saldoDepois, movAntes: 0, movDepois: 0 };
    atual.antes = saldoAntes;
    atual.depois = saldoDepois;
    atual.movDepois += 1;
    if (!e.extra) atual.movAntes += 1;
    porMes.set(mes, atual);
  }

  const ultimoCheckpointDoMes = new Map<string, { saldo: number; data: string }>();
  for (const c of [...input.checkpoints].sort((a, b) => a.data.localeCompare(b.data))) {
    ultimoCheckpointDoMes.set(c.data.slice(0, 7), { saldo: c.saldo, data: c.data });
  }

  const meses: MonthDiff[] = [...porMes.entries()]
    .filter(([mes]) => !primeiroMesAfetado || mes >= primeiroMesAfetado)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([mes, v]) => {
      const banco = ultimoCheckpointDoMes.get(mes)?.saldo ?? null;
      const difAntes = banco === null ? null : round(v.antes - banco);
      const difDepois = banco === null ? null : round(v.depois - banco);
      return {
        mes,
        rotulo: rotuloMes(mes),
        movimentosAntes: v.movAntes,
        movimentosDepois: v.movDepois,
        saldoAntes: v.antes,
        saldoDepois: v.depois,
        delta: round(v.depois - v.antes),
        saldoBanco: banco,
        diferencaAntes: difAntes,
        diferencaDepois: difDepois,
        confereAntes: difAntes === null ? null : Math.abs(difAntes) <= TOLERANCIA,
        confereDepois: difDepois === null ? null : Math.abs(difDepois) <= TOLERANCIA,
      };
    });

  const mesesCorrigidos = meses.filter((m) => m.confereAntes === false && m.confereDepois).length;
  const mesesAindaDivergentes = meses.filter((m) => m.confereDepois === false).length;

  return {
    executadoEm: new Date().toISOString(),
    dryRun: true,
    accountId: input.accountId,
    candidatos,
    meses,
    totais: {
      seriamRestauradas: restauraveis.length,
      naoSeriamRestauradas: candidatos.length - restauraveis.length,
      efeitoSaldoFinal: round(restauraveis.reduce((a, c) => a + c.preview.efeitoSaldo, 0)),
      mesesCorrigidos,
      mesesAindaDivergentes,
    },
    veredito: !candidatos.length
      ? "NADA_A_REPARAR"
      : restauraveis.length && !mesesAindaDivergentes
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
