/**
 * EXTRATO DIÁRIO DA CONTA — fonte única.
 *
 * O ledger continua sendo `transactions`. Aqui nada é criado nem persistido:
 * o "Saldo do dia" é SEMPRE derivado do ledger, nunca uma transação fictícia.
 *
 * Regra bancária clássica:
 *   saldo anterior → movimentos do dia → saldo do dia → próximo dia → … → saldo final
 *
 * Checkpoints (saldos impressos pelo banco no extrato importado) entram apenas
 * como conferência: comparamos o saldo calculado com o saldo informado e
 * apontamos exatamente em qual dia existe diferença.
 */
import type { Transaction } from "@/lib/transactions";

export type LedgerDirection = "IN" | "OUT" | "NEUTRO";

/** Ponto de conferência informado pelo banco (nunca é movimentação). */
export type BalanceCheckpoint = {
  data: string;
  saldo: number;
  rotulo?: string | null;
};

export type LedgerDay = {
  date: string;
  openingBalance: number;
  transactions: Transaction[];
  inflows: number;
  outflows: number;
  calculatedClosingBalance: number;
  /** Saldo do dia informado pelo banco, quando existir checkpoint. */
  reportedClosingBalance: number | null;
  /** banco − sistema. Null quando não há checkpoint. */
  difference: number | null;
  confere: boolean | null;
};

export type DailyBankLedger = {
  openingBalance: number;
  days: LedgerDay[];
  totalInflows: number;
  totalOutflows: number;
  closingBalance: number;
  /** Diferença apontada no último dia com checkpoint (0 quando confere). */
  difference: number | null;
};

const arredonda = (v: number) => Math.round(v * 100) / 100;

/** Efeito da transação no saldo da conta, com sinal. */
export function movementEffect(t: Transaction): number {
  const valor = Number(t.valor) || 0;
  switch (t.tipo) {
    case "ENTRADA":
      return Math.abs(valor);
    case "SAIDA":
    case "PAGAMENTO_CARTAO":
      return -Math.abs(valor);
    case "TRANSFERENCIA":
      return (t as { transfer_role?: string | null }).transfer_role === "ENTRADA"
        ? Math.abs(valor)
        : -Math.abs(valor);
    // Abertura e ajuste já vêm assinados: são posição patrimonial, não receita.
    default:
      return valor;
  }
}

export function movementDirection(t: Transaction): LedgerDirection {
  const efeito = movementEffect(t);
  if (efeito > 0) return "IN";
  if (efeito < 0) return "OUT";
  return "NEUTRO";
}

/** Ordena dentro do dia: ordem de criação preserva a sequência importada. */
function ordenarDoDia(a: Transaction, b: Transaction) {
  return String(a.created_at ?? "").localeCompare(String(b.created_at ?? ""));
}

/**
 * Constrói o extrato diário de uma conta.
 *
 * `startDate`/`endDate` em ISO (YYYY-MM-DD). O saldo anterior é derivado de
 * tudo que existe no ledger ANTES de `startDate` — ou, quando informado,
 * do `openingBalance` explícito (extrato oficial / abertura de saldo).
 */
export function buildDailyBankLedger(input: {
  accountId: string;
  transactions: Transaction[];
  startDate?: string | null;
  endDate?: string | null;
  openingBalance?: number | null;
  checkpoints?: BalanceCheckpoint[];
}): DailyBankLedger {
  const daConta = input.transactions.filter(
    (t) => t.bank_account_id === input.accountId && t.status !== "CANCELADA",
  );

  const anteriores = input.startDate
    ? daConta.filter((t) => t.data_movimento < input.startDate!)
    : [];

  const openingBalance = arredonda(
    input.openingBalance ?? anteriores.reduce((acc, t) => acc + movementEffect(t), 0),
  );

  const doPeriodo = daConta.filter(
    (t) =>
      (!input.startDate || t.data_movimento >= input.startDate) &&
      (!input.endDate || t.data_movimento <= input.endDate),
  );

  const porDia = new Map<string, Transaction[]>();
  for (const t of doPeriodo) {
    const lista = porDia.get(t.data_movimento) ?? [];
    lista.push(t);
    porDia.set(t.data_movimento, lista);
  }

  const checkpointPorDia = new Map<string, BalanceCheckpoint>();
  for (const c of input.checkpoints ?? []) checkpointPorDia.set(c.data, c);

  const datas = [...porDia.keys()].sort();

  let saldo = openingBalance;
  let totalInflows = 0;
  let totalOutflows = 0;
  let difference: number | null = null;

  const days: LedgerDay[] = datas.map((date) => {
    const lista = (porDia.get(date) ?? []).slice().sort(ordenarDoDia);
    const inflows = arredonda(
      lista.reduce((acc, t) => acc + Math.max(movementEffect(t), 0), 0),
    );
    const outflows = arredonda(
      lista.reduce((acc, t) => acc + Math.max(-movementEffect(t), 0), 0),
    );
    const openingBalanceDay = saldo;
    const fechamento = arredonda(openingBalanceDay + inflows - outflows);
    saldo = fechamento;
    totalInflows = arredonda(totalInflows + inflows);
    totalOutflows = arredonda(totalOutflows + outflows);

    const checkpoint = checkpointPorDia.get(date) ?? null;
    const diff = checkpoint ? arredonda(checkpoint.saldo - fechamento) : null;
    if (diff !== null) difference = diff;

    return {
      date,
      openingBalance: openingBalanceDay,
      transactions: lista,
      inflows,
      outflows,
      calculatedClosingBalance: fechamento,
      reportedClosingBalance: checkpoint?.saldo ?? null,
      difference: diff,
      confere: diff === null ? null : Math.abs(diff) <= 0.02,
    };
  });

  return {
    openingBalance,
    days,
    totalInflows,
    totalOutflows,
    closingBalance: arredonda(saldo),
    difference,
  };
}

/**
 * Série diária contínua para gráficos: dias sem movimento carregam o último
 * saldo conhecido. Ainda não é exibida em tela — os dados já ficam prontos.
 */
export function dailyBalanceSeries(
  ledger: DailyBankLedger,
  startDate: string,
  endDate: string,
): { date: string; balance: number }[] {
  const porDia = new Map(ledger.days.map((d) => [d.date, d.calculatedClosingBalance]));
  const serie: { date: string; balance: number }[] = [];
  let saldo = ledger.openingBalance;
  const cursor = new Date(`${startDate}T00:00:00`);
  const fim = new Date(`${endDate}T00:00:00`);
  while (cursor <= fim) {
    const iso = cursor.toISOString().slice(0, 10);
    if (porDia.has(iso)) saldo = porDia.get(iso)!;
    serie.push({ date: iso, balance: saldo });
    cursor.setDate(cursor.getDate() + 1);
  }
  return serie;
}

/** Extrato diário a partir de linhas lidas de um extrato (ainda sem ledger). */
export function buildDailyPreview(
  linhas: { data: string | null; valor: number }[],
  openingBalance: number,
  checkpoints: BalanceCheckpoint[] = [],
) {
  const porDia = new Map<string, { entradas: number; saidas: number; quantidade: number }>();
  for (const l of linhas) {
    if (!l.data) continue;
    const atual = porDia.get(l.data) ?? { entradas: 0, saidas: 0, quantidade: 0 };
    if (l.valor >= 0) atual.entradas += l.valor;
    else atual.saidas += Math.abs(l.valor);
    atual.quantidade += 1;
    porDia.set(l.data, atual);
  }
  const check = new Map(checkpoints.map((c) => [c.data, c.saldo]));
  let saldo = openingBalance;
  return [...porDia.keys()]
    .sort()
    .map((date) => {
      const d = porDia.get(date)!;
      const abertura = saldo;
      const fechamento = arredonda(abertura + d.entradas - d.saidas);
      saldo = fechamento;
      const informado = check.get(date) ?? null;
      const diff = informado === null ? null : arredonda(informado - fechamento);
      return {
        date,
        openingBalance: abertura,
        inflows: arredonda(d.entradas),
        outflows: arredonda(d.saidas),
        quantidade: d.quantidade,
        calculatedClosingBalance: fechamento,
        reportedClosingBalance: informado,
        difference: diff,
        confere: diff === null ? null : Math.abs(diff) <= 0.02,
      };
    });
}
