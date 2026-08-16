/**
 * AUDITORIA DA CONTA BANCÁRIA — somente leitura.
 *
 * Aqui nada é criado, corrigido ou ajustado. O motor apenas compara o que o
 * banco informou (extratos importados e saldos impressos) com o que o ledger
 * do aplicativo conseguiu reconstruir, apontando exatamente onde existe furo:
 * mês, dia, valor e provável causa.
 */
import type { Transaction } from "@/lib/transactions";
import { movementEffect } from "@/lib/bank-ledger";

export type Severity = "CRITICO" | "ATENCAO" | "PENDENCIA" | "INFORMATIVO";

export const SEVERITY_LABELS: Record<Severity, string> = {
  CRITICO: "Crítico",
  ATENCAO: "Atenção",
  PENDENCIA: "Pendência",
  INFORMATIVO: "Informativo",
};

export const SEVERITY_TONES: Record<Severity, "danger" | "warn" | "info" | "muted"> = {
  CRITICO: "danger",
  ATENCAO: "warn",
  PENDENCIA: "info",
  INFORMATIVO: "muted",
};

export type AuditIssue = {
  id: string;
  severity: Severity;
  titulo: string;
  detalhe: string;
  referencia?: string;
};

export type StatementPeriod = {
  id: string;
  nomeArquivo: string;
  inicio: string | null;
  fim: string | null;
  saldoInicial: number | null;
  saldoFinal: number | null;
  quantidade: number;
  status: string;
};

export type ContinuityLink = {
  anterior: StatementPeriod;
  proximo: StatementPeriod;
  saldoFinalAnterior: number | null;
  saldoInicialProximo: number | null;
  diferenca: number | null;
  confere: boolean;
  /** Dias sem cobertura entre o fim de um extrato e o início do seguinte. */
  lacuna: { inicio: string; fim: string; dias: number } | null;
  sobreposicao: boolean;
};

export type AuditDay = {
  date: string;
  openingBalance: number;
  inflows: number;
  outflows: number;
  calculated: number;
  reported: number | null;
  difference: number | null;
  confere: boolean | null;
  transactions: Transaction[];
};

export type AuditMonth = {
  key: string;
  imports: StatementPeriod[];
  openingBalance: number | null;
  inflows: number;
  outflows: number;
  calculated: number;
  reported: number | null;
  difference: number | null;
  confere: boolean | null;
  /** Diferença entre o saldo informado e o calculado — valor não identificado. */
  missingAmount: number | null;
  ajustes: Transaction[];
  days: AuditDay[];
  quantidade: number;
};

export type DuplicateGroup = {
  key: string;
  date: string;
  descricao: string;
  valor: number;
  direcao: "IN" | "OUT";
  ids: string[];
};

export type PendingItem = {
  transaction: Transaction;
  motivo: string;
};

export type TransferHint = {
  saida: Transaction;
  entrada: Transaction;
  contaDestino: string;
};

export type BankAudit = {
  periodoInicio: string | null;
  periodoFim: string | null;
  extratos: StatementPeriod[];
  continuidade: ContinuityLink[];
  meses: AuditMonth[];
  duplicidades: DuplicateGroup[];
  semAssociacao: PendingItem[];
  semCategoria: PendingItem[];
  pagamentosCartaoSemFatura: Transaction[];
  transferenciasProvaveis: TransferHint[];
  referenciaManual: {
    saldoInformado: number;
    data: string;
    saldoCalculado: number | null;
    diferenca: number | null;
    coberto: boolean;
    diasFaltando: number;
  } | null;
  resumo: {
    extratos: number;
    mesesComContinuidade: number;
    totalTransicoes: number;
    mesesComDivergencia: number;
    diasComDivergencia: number;
    semAssociacao: number;
    semCategoria: number;
    lacunas: number;
    sobreposicoes: number;
    duplicidades: number;
  };
  problemas: AuditIssue[];
};

const arredonda = (v: number) => Math.round(v * 100) / 100;
const CONFERE = 0.02;

/** Posição patrimonial: não é entrada nem saída do período. */
const POSTURA = ["ABERTURA_SALDO", "AJUSTE_SALDO"];

function normalizar(texto: string) {
  return texto
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function addDays(iso: string, dias: number) {
  const d = new Date(`${iso}T00:00:00`);
  d.setDate(d.getDate() + dias);
  return d.toISOString().slice(0, 10);
}

function diffDays(a: string, b: string) {
  const ms = new Date(`${b}T00:00:00`).getTime() - new Date(`${a}T00:00:00`).getTime();
  return Math.round(ms / 86400000);
}

export function buildBankAudit(input: {
  accountId: string;
  transactions: Transaction[];
  imports: {
    id: string;
    nome_arquivo: string;
    periodo_inicio: string | null;
    periodo_fim: string | null;
    saldo_inicial: number | string | null;
    saldo_final: number | string | null;
    quantidade_lancamentos: number | null;
    status: string;
  }[];
  checkpoints: { data: string; saldo: number }[];
  /** Compras vinculadas, para saber o que está sem categoria. */
  purchases?: { id: string; categoria_id: string | null }[];
  /** Faturas de cartão existentes na família. */
  cardInvoiceIds?: string[];
  /** Contas da família, para sugerir transferências internas. */
  accounts?: { id: string; nome_conta: string }[];
  /** Saldo de referência informado pelo titular (cadastro da conta). */
  saldoReferencia?: { saldo: number; data: string } | null;
}): BankAudit {
  const extratos: StatementPeriod[] = input.imports
    .filter((i) => i.status !== "CANCELLED" && i.status !== "ERROR")
    .map((i) => ({
      id: i.id,
      nomeArquivo: i.nome_arquivo,
      inicio: i.periodo_inicio,
      fim: i.periodo_fim,
      saldoInicial: i.saldo_inicial === null ? null : Number(i.saldo_inicial),
      saldoFinal: i.saldo_final === null ? null : Number(i.saldo_final),
      quantidade: i.quantidade_lancamentos ?? 0,
      status: i.status,
    }))
    .sort((a, b) => String(a.inicio ?? "").localeCompare(String(b.inicio ?? "")));

  const daConta = input.transactions
    .filter((t) => t.bank_account_id === input.accountId && t.status !== "CANCELADA")
    .sort(
      (a, b) =>
        a.data_movimento.localeCompare(b.data_movimento) ||
        String(a.created_at ?? "").localeCompare(String(b.created_at ?? "")),
    );

  const periodoInicio = extratos.find((e) => e.inicio)?.inicio ?? daConta[0]?.data_movimento ?? null;
  const periodoFim =
    [...extratos].reverse().find((e) => e.fim)?.fim ??
    daConta[daConta.length - 1]?.data_movimento ??
    null;

  // ---------- continuidade, lacunas e sobreposições ----------
  const comPeriodo = extratos.filter((e) => e.inicio && e.fim);
  const continuidade: ContinuityLink[] = [];
  for (let i = 1; i < comPeriodo.length; i++) {
    const anterior = comPeriodo[i - 1]!;
    const proximo = comPeriodo[i]!;
    const diferenca =
      anterior.saldoFinal === null || proximo.saldoInicial === null
        ? null
        : arredonda(proximo.saldoInicial - anterior.saldoFinal);
    const sobreposicao = proximo.inicio! <= anterior.fim!;
    const gapInicio = addDays(anterior.fim!, 1);
    const dias = diffDays(gapInicio, proximo.inicio!);
    continuidade.push({
      anterior,
      proximo,
      saldoFinalAnterior: anterior.saldoFinal,
      saldoInicialProximo: proximo.saldoInicial,
      diferenca,
      confere: diferenca !== null && Math.abs(diferenca) <= CONFERE,
      lacuna:
        !sobreposicao && dias > 0
          ? { inicio: gapInicio, fim: addDays(proximo.inicio!, -1), dias }
          : null,
      sobreposicao,
    });
  }

  // ---------- auditoria mensal e diária ----------
  const checkpointPorDia = new Map(input.checkpoints.map((c) => [c.data, c.saldo]));
  const mesesKeys = new Set<string>();
  for (const e of comPeriodo) mesesKeys.add(e.inicio!.slice(0, 7));
  for (const t of daConta) mesesKeys.add(t.data_movimento.slice(0, 7));

  const meses: AuditMonth[] = [...mesesKeys]
    .sort()
    .map((key) => {
      const doMes = daConta.filter((t) => t.data_movimento.slice(0, 7) === key);
      const importsDoMes = comPeriodo.filter((e) => e.inicio!.slice(0, 7) === key);
      const abertura = importsDoMes[0]?.saldoInicial ?? null;
      const reported = importsDoMes[importsDoMes.length - 1]?.saldoFinal ?? null;

      const ajustes = doMes.filter((t) => POSTURA.includes(t.tipo));
      const movimentos = doMes.filter((t) => !POSTURA.includes(t.tipo));

      const porDia = new Map<string, Transaction[]>();
      for (const t of movimentos) {
        const lista = porDia.get(t.data_movimento) ?? [];
        lista.push(t);
        porDia.set(t.data_movimento, lista);
      }

      let saldo = abertura ?? 0;
      let inflows = 0;
      let outflows = 0;
      const days: AuditDay[] = [...porDia.keys()].sort().map((date) => {
        const lista = porDia.get(date)!;
        const entradas = arredonda(
          lista.reduce((acc, t) => acc + Math.max(movementEffect(t), 0), 0),
        );
        const saidas = arredonda(
          lista.reduce((acc, t) => acc + Math.max(-movementEffect(t), 0), 0),
        );
        const openingBalance = saldo;
        const calculated = arredonda(openingBalance + entradas - saidas);
        saldo = calculated;
        inflows = arredonda(inflows + entradas);
        outflows = arredonda(outflows + saidas);
        const informado = checkpointPorDia.get(date) ?? null;
        const difference = informado === null ? null : arredonda(informado - calculated);
        return {
          date,
          openingBalance,
          inflows,
          outflows,
          calculated,
          reported: informado,
          difference,
          confere: difference === null ? null : Math.abs(difference) <= CONFERE,
          transactions: lista,
        };
      });

      const calculated = arredonda((abertura ?? 0) + inflows - outflows);
      const difference = reported === null ? null : arredonda(reported - calculated);

      return {
        key,
        imports: importsDoMes,
        openingBalance: abertura,
        inflows,
        outflows,
        calculated,
        reported,
        difference,
        confere: difference === null ? null : Math.abs(difference) <= CONFERE,
        missingAmount: difference !== null && Math.abs(difference) > CONFERE ? difference : null,
        ajustes,
        days,
        quantidade: movimentos.length,
      };
    });

  // ---------- duplicidades ----------
  const grupos = new Map<string, Transaction[]>();
  for (const t of daConta) {
    if (POSTURA.includes(t.tipo)) continue;
    const efeito = movementEffect(t);
    const key = [
      t.data_movimento,
      Math.abs(Number(t.valor)).toFixed(2),
      efeito >= 0 ? "IN" : "OUT",
      normalizar(t.descricao ?? ""),
    ].join("|");
    grupos.set(key, [...(grupos.get(key) ?? []), t]);
  }
  const duplicidades: DuplicateGroup[] = [...grupos.entries()]
    .filter(([, lista]) => lista.length > 1)
    .map(([key, lista]) => ({
      key,
      date: lista[0]!.data_movimento,
      descricao: lista[0]!.descricao ?? "",
      valor: Math.abs(Number(lista[0]!.valor)),
      direcao: movementEffect(lista[0]!) >= 0 ? ("IN" as const) : ("OUT" as const),
      ids: lista.map((t) => t.id),
    }))
    .sort((a, b) => b.date.localeCompare(a.date));

  // ---------- associação e categoria ----------
  const categoriaPorCompra = new Map(
    (input.purchases ?? []).map((p) => [p.id, p.categoria_id ?? null]),
  );
  const semAssociacao: PendingItem[] = [];
  const semCategoria: PendingItem[] = [];
  const pagamentosCartaoSemFatura: Transaction[] = [];
  const invoiceIds = new Set(input.cardInvoiceIds ?? []);

  for (const t of daConta) {
    if (POSTURA.includes(t.tipo)) continue;
    const extra = t as Transaction & {
      transfer_group_id?: string | null;
      natureza?: string | null;
    };
    const associado =
      !!t.purchase_id ||
      !!t.income_id ||
      !!t.card_invoice_id ||
      !!extra.transfer_group_id ||
      !!extra.natureza;
    if (!associado) {
      semAssociacao.push({
        transaction: t,
        motivo: "Sem vínculo com compra, receita, fatura, transferência ou tarifa.",
      });
    }
    if (t.purchase_id && !categoriaPorCompra.get(t.purchase_id)) {
      semCategoria.push({
        transaction: t,
        motivo: "Saldo confere, mas a compra ainda não tem categoria definida.",
      });
    }
    const pareceCartao =
      t.tipo === "PAGAMENTO_CARTAO" || /CARTAO|CARTÃO/i.test(t.descricao ?? "");
    if (pareceCartao && (!t.card_invoice_id || !invoiceIds.has(t.card_invoice_id))) {
      pagamentosCartaoSemFatura.push(t);
    }
  }

  // ---------- transferências internas prováveis ----------
  const nomePorConta = new Map((input.accounts ?? []).map((a) => [a.id, a.nome_conta]));
  const outras = input.transactions.filter(
    (t) =>
      t.bank_account_id &&
      t.bank_account_id !== input.accountId &&
      t.status !== "CANCELADA" &&
      !(t as { transfer_group_id?: string | null }).transfer_group_id,
  );
  const transferenciasProvaveis: TransferHint[] = [];
  for (const saida of daConta) {
    if (movementEffect(saida) >= 0) continue;
    if ((saida as { transfer_group_id?: string | null }).transfer_group_id) continue;
    const par = outras.find(
      (t) =>
        t.data_movimento === saida.data_movimento &&
        movementEffect(t) > 0 &&
        Math.abs(Math.abs(Number(t.valor)) - Math.abs(Number(saida.valor))) <= CONFERE,
    );
    if (par && par.bank_account_id) {
      transferenciasProvaveis.push({
        saida,
        entrada: par,
        contaDestino: nomePorConta.get(par.bank_account_id) ?? "Outra conta",
      });
    }
  }

  // ---------- saldo de referência manual ----------
  let referenciaManual: BankAudit["referenciaManual"] = null;
  if (input.saldoReferencia) {
    const { saldo, data } = input.saldoReferencia;
    const coberto = !!periodoFim && periodoFim >= data;
    const saldoCalculado = coberto
      ? arredonda(
          daConta
            .filter((t) => t.data_movimento <= data)
            .reduce((acc, t) => acc + movementEffect(t), 0),
        )
      : null;
    referenciaManual = {
      saldoInformado: saldo,
      data,
      saldoCalculado,
      diferenca: saldoCalculado === null ? null : arredonda(saldo - saldoCalculado),
      coberto,
      diasFaltando: coberto || !periodoFim ? 0 : Math.max(diffDays(periodoFim, data), 0),
    };
  }

  // ---------- problemas encontrados ----------
  const problemas: AuditIssue[] = [];
  for (const m of meses) {
    if (m.confere === false) {
      problemas.push({
        id: `mes-${m.key}`,
        severity: "CRITICO",
        titulo: `${m.key} — saldo do mês não fecha`,
        detalhe: `Diferença de ${m.difference} entre o saldo informado pelo banco e o calculado. Possível valor não identificado.`,
        referencia: m.key,
      });
    }
    for (const d of m.days) {
      if (d.confere === false) {
        problemas.push({
          id: `dia-${d.date}`,
          severity: "CRITICO",
          titulo: `${d.date} — diferença de saldo no dia`,
          detalhe: "Possível movimentação ausente ou duplicada neste dia.",
          referencia: m.key,
        });
      }
    }
  }
  for (const c of continuidade) {
    if (!c.confere) {
      problemas.push({
        id: `cont-${c.anterior.id}`,
        severity: "ATENCAO",
        titulo: "Quebra de continuidade entre extratos",
        detalhe: `O extrato anterior fecha em um valor diferente do que o seguinte abre. Diferença de ${c.diferenca}.`,
      });
    }
    if (c.lacuna) {
      problemas.push({
        id: `gap-${c.anterior.id}`,
        severity: c.confere ? "INFORMATIVO" : "ATENCAO",
        titulo: `Período sem extrato: ${c.lacuna.inicio} a ${c.lacuna.fim}`,
        detalhe: c.confere
          ? "Continuidade financeira preservada, mas sem detalhamento."
          : "Faltam movimentações neste intervalo.",
      });
    }
    if (c.sobreposicao) {
      problemas.push({
        id: `over-${c.anterior.id}`,
        severity: "ATENCAO",
        titulo: "Períodos sobrepostos entre extratos",
        detalhe: "Dois extratos cobrem o mesmo intervalo — risco de contagem em dobro.",
      });
    }
  }
  for (const d of duplicidades) {
    problemas.push({
      id: `dup-${d.key}`,
      severity: "ATENCAO",
      titulo: `Possível duplicidade em ${d.date}`,
      detalhe: `${d.descricao} — ${d.ids.length} lançamentos idênticos.`,
    });
  }
  for (const t of pagamentosCartaoSemFatura) {
    problemas.push({
      id: `cartao-${t.id}`,
      severity: "PENDENCIA",
      titulo: "Pagamento de cartão sem fatura associada",
      detalhe: `${t.data_movimento} · ${t.descricao}`,
    });
  }
  if (semAssociacao.length) {
    problemas.push({
      id: "assoc",
      severity: "PENDENCIA",
      titulo: `${semAssociacao.length} movimentações sem associação`,
      detalhe: "O saldo fecha, mas essas movimentações ainda não têm origem definida.",
    });
  }
  if (semCategoria.length) {
    problemas.push({
      id: "categoria",
      severity: "INFORMATIVO",
      titulo: `${semCategoria.length} movimentações sem categoria`,
      detalhe: "Financeiramente corretas, apenas sem classificação de gasto.",
    });
  }

  const lacunas = continuidade.filter((c) => c.lacuna).length;
  const sobreposicoes = continuidade.filter((c) => c.sobreposicao).length;

  return {
    periodoInicio,
    periodoFim,
    extratos,
    continuidade,
    meses,
    duplicidades,
    semAssociacao,
    semCategoria,
    pagamentosCartaoSemFatura,
    transferenciasProvaveis,
    referenciaManual,
    resumo: {
      extratos: extratos.length,
      mesesComContinuidade: continuidade.filter((c) => c.confere).length,
      totalTransicoes: continuidade.length,
      mesesComDivergencia: meses.filter((m) => m.confere === false).length,
      diasComDivergencia: meses.reduce(
        (acc, m) => acc + m.days.filter((d) => d.confere === false).length,
        0,
      ),
      semAssociacao: semAssociacao.length,
      semCategoria: semCategoria.length,
      lacunas,
      sobreposicoes,
      duplicidades: duplicidades.length,
    },
    problemas,
  };
}

/** Exporta o relatório em CSV (somente leitura, nada é alterado). */
export function auditToCsv(audit: BankAudit) {
  const linhas: string[][] = [["Seção", "Referência", "Descrição", "Valor", "Status"]];
  for (const c of audit.continuidade) {
    linhas.push([
      "Continuidade",
      `${c.anterior.fim} → ${c.proximo.inicio}`,
      `Fecha ${c.saldoFinalAnterior} / abre ${c.saldoInicialProximo}`,
      String(c.diferenca ?? ""),
      c.confere ? "Confere" : "Quebra de continuidade",
    ]);
  }
  for (const m of audit.meses) {
    linhas.push([
      "Mês",
      m.key,
      `Inicial ${m.openingBalance ?? ""} · Entradas ${m.inflows} · Saídas ${m.outflows}`,
      String(m.difference ?? ""),
      m.confere === null ? "Sem saldo informado" : m.confere ? "Confere" : "Divergência",
    ]);
    for (const d of m.days) {
      linhas.push([
        "Dia",
        d.date,
        `Entradas ${d.inflows} · Saídas ${d.outflows} · Calculado ${d.calculated}`,
        String(d.difference ?? ""),
        d.confere === null ? "Sem conferência" : d.confere ? "Confere" : "Divergência",
      ]);
    }
  }
  for (const p of audit.problemas) {
    linhas.push(["Problema", p.referencia ?? "", `${p.titulo} — ${p.detalhe}`, "", p.severity]);
  }
  return linhas
    .map((l) => l.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(";"))
    .join("\n");
}
