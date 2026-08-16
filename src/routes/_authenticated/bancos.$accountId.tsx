import { useMemo, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { FileUp, MoreHorizontal, Plus, Receipt, Undo2 } from "lucide-react";
import { FormDialog } from "@/components/form-dialog";
import { ConfirmDialog } from "@/components/record-actions";
import { BankAccountForm } from "@/components/forms/bank-account-form";
import { archiveBankAccount } from "@/lib/bank-accounts";

import { SearchInput, matchesSearch } from "@/components/search-input";
import { EmptyState } from "@/components/empty-state";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, inputClass } from "@/components/page-header";
import { Badge, DetailHeader, Metric, SectionTitle } from "@/components/detail-page";
import { useFamily } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { usePurchases } from "@/hooks/usePurchases";
import { useMemberName } from "@/components/member-select";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/bank-accounts";
import { currentMonth, formatDate, monthLabel } from "@/lib/expenses";
import { formatCurrency } from "@/lib/finance";
import {
  TRANSACTION_STATUS_CLASSES,
  TRANSACTION_STATUS_LABELS,
  type Transaction,
} from "@/lib/transactions";
import type { Purchase } from "@/lib/purchases";
import { NoFamily } from "@/components/no-family";
import { BalanceDialog } from "@/components/bank/balance-dialog";
import { BankStatementDialog } from "@/components/bank/statement-import-dialog";
import { MovementDialog } from "@/components/bank/movement-dialog";
import { TransferDialog } from "@/components/transfer-dialog";
import { useReverseBankTransaction } from "@/hooks/useBankMovements";
import { useBankBalanceCheckpoints } from "@/hooks/useBankLedger";
import { buildDailyBankLedger, movementEffect } from "@/lib/bank-ledger";
import { MOVEMENT_NATURE_LABELS, type MovementNature } from "@/lib/bank-movements";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { toast } from "sonner";
import { usePermissions } from "@/hooks/usePermissions";

export const Route = createFileRoute("/_authenticated/bancos/$accountId")({
  head: () => ({
    meta: [
      { title: "Detalhes da conta — Família Finance AI" },
      {
        name: "description",
        content:
          "Página completa da conta bancária: saldo, entradas, saídas, pagamentos de cartão e extrato detalhado com filtros.",
      },
      { property: "og:title", content: "Detalhes da conta — Família Finance AI" },
      {
        property: "og:description",
        content: "Extrato completo da conta bancária com filtros por período, tipo e descrição.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: ContaDetalhePage,
});

/** Classificação legível da origem de cada movimentação bancária. */
function origemDoMovimento(t: Transaction, compra?: Purchase) {
  const natureza = (t as { natureza?: string | null }).natureza as MovementNature | null | undefined;
  if (natureza && MOVEMENT_NATURE_LABELS[natureza]) return MOVEMENT_NATURE_LABELS[natureza];
  if (t.tipo === "PAGAMENTO_CARTAO") return "Pagamento de cartão";
  if (t.tipo === "ENTRADA") return "Entrada";
  if (t.tipo === "TRANSFERENCIA") return "Transferência";
  if (t.tipo === "AJUSTE_SALDO") return "Ajuste de saldo";
  if (t.tipo === "ABERTURA_SALDO") return "Abertura de saldo";
  switch (compra?.forma_pagamento) {
    case "PIX":
      return "PIX";
    case "DEBITO":
      return "Débito";
    case "BOLETO":
      return "Boleto";
    case "TRANSFERENCIA":
      return "Transferência";
    case "DINHEIRO":
      return "Dinheiro";
    default:
      return "Outros";
  }
}

const ORIGENS = [
  "Dinheiro em espécie",
  "Receita",
  "Transferência externa",
  "Estorno",
  "Despesa",
  "Entrada",
  "PIX",
  "Débito",
  "Boleto",
  "Transferência",
  "Pagamento de cartão",
  "Ajuste de saldo",
  "Abertura de saldo",
  "Dinheiro",
  "Outros",
];

function ContaDetalhePage() {
  const { accountId } = Route.useParams();
  const { data: family } = useFamily();
  const { data: accounts } = useBankAccounts(family?.id);
  const { data: movimentos } = useTransactions(family?.id);
  const { data: purchases } = usePurchases(family?.id);
  const memberName = useMemberName(family?.id);
  const { data: checkpoints } = useBankBalanceCheckpoints(accountId);


  const perms = usePermissions();
  const [acao, setAcao] = useState<null | "SALDO" | "PDF" | "IMAGEM" | "DEPOSITO" | "RETIRADA" | "TRANSFERENCIA">(null);
  const estornar = useReverseBankTransaction(family?.id);
  const queryClient = useQueryClient();
  const [editando, setEditando] = useState(false);
  const [arquivando, setArquivando] = useState(false);
  const [saldoSugerido, setSaldoSugerido] = useState<number | null>(null);

  const [periodo, setPeriodo] = useState(currentMonth());
  const [filtroOrigem, setFiltroOrigem] = useState("");
  const [busca, setBusca] = useState("");

  const compraPorId = useMemo(() => {
    const map = new Map<string, Purchase>();
    for (const p of purchases ?? []) map.set(p.id, p);
    return map;
  }, [purchases]);

  if (!family) return <NoFamily />;

  const conta = (accounts ?? []).find((a) => a.id === accountId) ?? null;
  if (!conta) {
    return (
      <div>
        <DetailHeader backTo="/bancos" backLabel="Voltar para Bancos" title="Conta não encontrada" />
        <Card>
          <p className="text-sm text-muted-foreground">
            Esta conta não existe ou não está disponível para o seu perfil.
          </p>
        </Card>
      </div>
    );
  }

  const movimentosDaConta = (movimentos ?? []).filter((t) => t.bank_account_id === conta.id);
  const temPosicao =
    Number(conta.saldo_atual) !== 0 ||
    movimentosDaConta.some((t) => t.tipo === "ABERTURA_SALDO");
  // Onboarding só para conta nunca inicializada: sem qualquer transação (inclusive
  // abertura/ajuste/canceladas, que provam que já houve evento financeiro) e sem saldo.
  const contaNuncaInicializada = movimentosDaConta.length === 0 && Number(conta.saldo_atual) === 0;

  const podeOperar =
    perms.isAdmin || (perms.podeLancar && conta.member_id === perms.myMemberId);

  // O saldo atual já é atualizado pelas movimentações; aqui apenas as apresentamos.
  const hoje = new Date().toISOString().slice(0, 10);
  const inicio = periodo ? `${periodo}-01` : null;
  const fim = periodo ? ultimoDiaDoMes(periodo) : null;

  const doPeriodo = (movimentos ?? []).filter(
    (t) =>
      t.bank_account_id === conta.id &&
      t.status !== "CANCELADA" &&
      (!periodo || t.data_movimento.startsWith(periodo)),
  );

  // Extrato realizado: até hoje. O que vem depois é previsão, nunca saldo.
  const realizados = doPeriodo.filter((t) => t.data_movimento <= hoje);
  const proximos = doPeriodo
    .filter((t) => t.data_movimento > hoje)
    .sort((a, b) => a.data_movimento.localeCompare(b.data_movimento));

  const ledger = buildDailyBankLedger({
    accountId: conta.id,
    transactions: (movimentos ?? []).filter((t) => t.data_movimento <= hoje),
    startDate: inicio,
    endDate: fim && fim < hoje ? fim : hoje,
    checkpoints: checkpoints ?? [],
  });

  const soma = (tipo: Transaction["tipo"], rows = doPeriodo) =>
    rows.filter((t) => t.tipo === tipo).reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  // Abertura de saldo é posição patrimonial: nunca entra como receita do período.
  const entradas = ledger.totalInflows;
  const saidas = ledger.totalOutflows;
  const pagamentos = soma("PAGAMENTO_CARTAO", realizados);
  const transferencias = soma("TRANSFERENCIA", realizados);
  const resultado = entradas - saidas;

  const origemDe = (t: Transaction) =>
    origemDoMovimento(t, t.purchase_id ? compraPorId.get(t.purchase_id) : undefined);

  const passaNoFiltro = (t: Transaction) =>
    (!filtroOrigem || origemDe(t) === filtroOrigem) && matchesSearch(busca, t.descricao);

  const filtrandoAlgo = Boolean(filtroOrigem || busca);
  const dias = ledger.days
    .map((dia) => ({ ...dia, visiveis: dia.transactions.filter(passaNoFiltro) }))
    .filter((dia) => !filtrandoAlgo || dia.visiveis.length > 0);

  const diasComDivergencia = ledger.days.filter((d) => d.confere === false);

  const somaPorOrigem = (origem: string, tipos: Transaction["tipo"][]) =>
    realizados
      .filter((t) => tipos.includes(t.tipo) && origemDe(t) === origem)
      .reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  const saidasPix = somaPorOrigem("PIX", ["SAIDA"]) + somaPorOrigem("Débito", ["SAIDA"]);
  const saidasBoleto = somaPorOrigem("Boleto", ["SAIDA"]);
  const saidasDiretas = soma("SAIDA", realizados);
  // Tarifas, IOF e juros são saídas reais: nunca podem sumir do resumo.
  const saidasTarifas = realizados
    .filter(
      (t) =>
        t.tipo === "SAIDA" &&
        !t.purchase_id &&
        /iof|tarifa|taxa|juros|anuidade/i.test(t.descricao ?? ""),
    )
    .reduce((acc, t) => acc + (Number(t.valor) || 0), 0);
  const saidasOutras = saidasDiretas - saidasPix - saidasBoleto - saidasTarifas;

  const entradasLista = realizados.filter((t) => t.tipo === "ENTRADA");


  return (
    <div>
      <DetailHeader
        backTo="/bancos"
        backLabel="Voltar para Bancos"
        title={`${conta.banco} · ${conta.nome_conta}`}
        subtitle={`Titular: ${memberName(conta.member_id)}`}
        badges={
          <>
            <Badge>{BANK_ACCOUNT_TYPE_LABELS[conta.tipo_conta]}</Badge>
            <Badge tone={conta.ativo ? "ok" : "muted"}>{conta.ativo ? "Ativa" : "Inativa"}</Badge>
          </>
        }
        actions={
          <div className="flex flex-wrap items-center gap-2">
            {podeOperar && (
              <>
                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-full bg-primary px-4 py-1.5 text-xs font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90">
                    <Plus className="size-3.5" />
                    Nova movimentação
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => setAcao("DEPOSITO")}>
                      Depósito
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setAcao("RETIRADA")}>
                      Retirada
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setAcao("TRANSFERENCIA")}>
                      Transferência
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>

                <DropdownMenu>
                  <DropdownMenuTrigger className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted">
                    <FileUp className="size-3.5" />
                    Importar / Conferir
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => setAcao("PDF")}>
                      Importar extrato
                    </DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => setAcao("IMAGEM")}>
                      Enviar print
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              </>
            )}

            <DropdownMenu>
              <DropdownMenuTrigger
                aria-label="Mais ações da conta"
                className="inline-flex items-center gap-1.5 rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
              >
                <MoreHorizontal className="size-3.5" />
                Mais
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                {podeOperar && (
                  <DropdownMenuItem onSelect={() => setAcao("SALDO")}>
                    {temPosicao ? "Ajustar saldo" : "Informar saldo"}
                  </DropdownMenuItem>
                )}
                {podeOperar && (
                  <DropdownMenuItem onSelect={() => setEditando(true)}>
                    Editar conta
                  </DropdownMenuItem>
                )}
                {podeOperar && (
                  <DropdownMenuItem onSelect={() => setArquivando(true)}>
                    {conta.ativo ? "Arquivar conta" : "Reativar conta"}
                  </DropdownMenuItem>
                )}
                {conta.member_id && (
                  <DropdownMenuItem asChild>
                    <Link to="/membro/$memberId" params={{ memberId: conta.member_id }}>
                      Ver perfil do titular
                    </Link>
                  </DropdownMenuItem>
                )}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
        }
      />

      {podeOperar && contaNuncaInicializada && (
        <Card className="mb-4 border-primary/30 bg-primary/5">
          <SectionTitle
            title="Como você quer começar?"
            hint="Esta conta ainda não tem movimentações. Escolha o ponto de partida."
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <ZeroOption
              titulo="Informar saldo atual"
              descricao="Registra a posição da conta. Não vira receita."
              onClick={() => setAcao("SALDO")}
            />
            <ZeroOption
              titulo="Importar extrato"
              descricao="PDF hoje. Passa por revisão antes de lançar."
              onClick={() => setAcao("PDF")}
            />
          </div>
          <p className="mt-3 text-xs text-muted-foreground">
            Ou{" "}
            <button
              type="button"
              onClick={() => setAcao("DEPOSITO")}
              className="font-semibold text-primary underline-offset-2 hover:underline"
            >
              registre uma movimentação manual
            </button>
            .
          </p>
        </Card>
      )}

      <FormDialog
        open={editando}
        onOpenChange={(open) => {
          if (!open) setEditando(false);
        }}
        title="Editar conta bancária"
        description="Somente dados cadastrais. Saldo e movimentações continuam aqui em Bancos."
      >
        <BankAccountForm
          familyId={family.id}
          memberId={conta.member_id ?? ""}
          account={conta}
          onSaved={() => setEditando(false)}
          onCancel={() => setEditando(false)}
        />
      </FormDialog>

      <ConfirmDialog
        open={arquivando}
        onOpenChange={setArquivando}
        title={conta.ativo ? "Arquivar conta" : "Reativar conta"}
        description={
          conta.ativo
            ? "A conta some das seleções de pagamento, mas o extrato continua disponível."
            : "A conta volta a ficar disponível para novos lançamentos."
        }
        confirmLabel={conta.ativo ? "Arquivar" : "Reativar"}
        onConfirm={async () => {
          await archiveBankAccount(conta.id, !conta.ativo);
          await queryClient.invalidateQueries({ queryKey: ["bank-accounts", family.id] });
          setArquivando(false);
          toast.success(conta.ativo ? "Conta arquivada." : "Conta reativada.");
        }}
      />


      <MovementDialog
        account={acao === "DEPOSITO" || acao === "RETIRADA" ? conta : null}
        familyId={family.id}
        direcao={acao === "RETIRADA" ? "SAIDA" : "ENTRADA"}
        onClose={() => setAcao(null)}
      />
      <TransferDialog
        open={acao === "TRANSFERENCIA"}
        onOpenChange={(v) => setAcao(v ? "TRANSFERENCIA" : null)}
        familyId={family.id}
        accounts={(accounts ?? []).filter((a) => a.ativo)}
        defaultOrigem={conta.id}
      />

      <BalanceDialog
        account={acao === "SALDO" ? conta : null}
        familyId={family.id}
        primeiraVez={!temPosicao}
        saldoSugerido={saldoSugerido}
        onClose={() => {
          setAcao(null);
          setSaldoSugerido(null);
        }}
      />
      <BankStatementDialog
        account={acao === "PDF" || acao === "IMAGEM" ? conta : null}
        familyId={family.id}
        modo={acao === "IMAGEM" ? "IMAGEM" : "PDF"}
        onClose={() => setAcao(null)}
        onUsarSaldo={(valor) => {
          setSaldoSugerido(valor);
          setAcao("SALDO");
        }}
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Saldo atual" value={formatCurrency(Number(conta.saldo_atual) || 0)} big />
        <Metric label="Entradas do período" value={formatCurrency(entradas)} />
        <Metric label="Saídas do período" value={formatCurrency(saidas)} />
        <Metric label="Pagamentos de cartão" value={formatCurrency(pagamentos)} />
        <Metric
          label="Movimento líquido do período"
          value={formatCurrency(resultado)}
          tone={resultado < 0 ? "danger" : "ok"}
        />
      </div>

      <Card className="mt-4">
        <SectionTitle
          title="Filtros do extrato"
          hint={`Movimentações de ${periodo ? monthLabel(periodo) : "todo o histórico"}.`}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Período">
            <input
              type="month"
              className={inputClass}
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
            />
          </Field>
          <Field label="Tipo de movimentação">
            <select
              className={inputClass}
              value={filtroOrigem}
              onChange={(e) => setFiltroOrigem(e.target.value)}
              aria-label="Tipo de movimentação"
            >
              <option value="">Todos</option>
              {ORIGENS.map((o) => (
                <option key={o} value={o}>
                  {o}
                </option>
              ))}
            </select>
          </Field>
          <SearchInput
            value={busca}
            onChange={setBusca}
            label="Buscar descrição"
            placeholder="Ex.: mercado, fatura, salário"
          />
        </div>
      </Card>

      <Card className="mt-4">
        <SectionTitle
          title="Extrato da conta"
          hint="Saldo anterior, movimentos do dia e saldo do dia — igual ao extrato do banco."
        />

        {diasComDivergencia.length > 0 && (
          <div className="mb-4 rounded-2xl border border-destructive/40 bg-destructive/5 p-3 text-xs">
            <span className="font-semibold text-destructive">
              {diasComDivergencia.length === 1
                ? "1 dia diverge do saldo informado pelo banco"
                : `${diasComDivergencia.length} dias divergem do saldo informado pelo banco`}
            </span>
            <ul className="mt-1 space-y-0.5 text-muted-foreground">
              {diasComDivergencia.slice(0, 5).map((d) => (
                <li key={d.date}>
                  {formatDate(d.date)}: banco {formatCurrency(d.reportedClosingBalance ?? 0)} ·
                  sistema {formatCurrency(d.calculatedClosingBalance)} (diferença{" "}
                  {formatCurrency(d.difference ?? 0)})
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex items-center justify-between gap-3 rounded-xl bg-muted/50 px-3 py-2.5">
          <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Saldo anterior
          </span>
          <span className="text-sm font-bold">{formatCurrency(ledger.openingBalance)}</span>
        </div>

        {dias.length === 0 ? (
          <div className="mt-3">
            <EmptyState
              icon={<Receipt className="size-5" />}
              title="Nenhuma movimentação neste período"
              description="Entradas, compras no PIX/débito e pagamentos de fatura desta conta aparecem aqui."
            />
          </div>
        ) : (
          <div className="mt-3 space-y-4">
            {dias.map((dia) => (
              <div key={dia.date} className="rounded-2xl border border-border">
                <div className="flex items-center justify-between gap-3 border-b border-border px-3 py-2">
                  <span className="text-xs font-semibold">{formatDate(dia.date)}</span>
                  <span className="text-[11px] text-muted-foreground">
                    Entradas {formatCurrency(dia.inflows)} · Saídas {formatCurrency(dia.outflows)}
                  </span>
                </div>

                <ul className="divide-y divide-border">
                  {dia.visiveis.map((t) => (
                    <li key={t.id} className="flex items-start justify-between gap-3 px-3 py-2.5">
                      <span className="min-w-0">
                        <span className="block text-sm font-semibold">{t.descricao}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {origemDe(t)}
                          {t.tipo === "TRANSFERENCIA" &&
                            " · transferência interna, não é gasto da família"}
                        </span>
                      </span>
                      <span className="flex shrink-0 items-center gap-2">
                        <span
                          className={`text-sm font-bold ${
                            movementEffect(t) >= 0 ? "text-emerald-600" : "text-foreground"
                          }`}
                        >
                          {movementEffect(t) >= 0 ? "+" : "−"}
                          {formatCurrency(Math.abs(movementEffect(t)))}
                        </span>
                        <span
                          className={`inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TRANSACTION_STATUS_CLASSES[t.status]}`}
                        >
                          {TRANSACTION_STATUS_LABELS[t.status]}
                        </span>
                        {podeOperar && podeEstornar(t) ? (
                          <button
                            type="button"
                            disabled={estornar.isPending}
                            onClick={() =>
                              estornar.mutate(
                                { transactionId: t.id },
                                {
                                  onSuccess: () =>
                                    toast.success(
                                      "Estorno registrado. O lançamento original continua no histórico.",
                                    ),
                                  onError: (err: Error) => toast.error(err.message),
                                },
                              )
                            }
                            aria-label="Estornar movimentação"
                            className="inline-flex items-center gap-1 rounded-full border border-border px-2.5 py-1 text-[11px] font-semibold text-muted-foreground transition-colors hover:bg-muted disabled:opacity-50"
                          >
                            <Undo2 className="size-3" />
                            Estornar
                          </button>
                        ) : null}
                      </span>
                    </li>
                  ))}
                </ul>

                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-3 py-2">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Saldo do dia
                  </span>
                  <span className="flex items-center gap-2">
                    {dia.confere === true && <Badge tone="ok">Confere com o banco</Badge>}
                    {dia.confere === false && (
                      <Badge tone="danger">
                        Banco: {formatCurrency(dia.reportedClosingBalance ?? 0)} · diferença{" "}
                        {formatCurrency(dia.difference ?? 0)}
                      </Badge>
                    )}
                    <span className="text-sm font-bold">
                      {formatCurrency(dia.calculatedClosingBalance)}
                    </span>
                  </span>
                </div>
              </div>
            ))}

            <div className="flex items-center justify-between gap-3 rounded-xl bg-primary/5 px-3 py-2.5">
              <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Saldo final do período
              </span>
              <span className="text-sm font-bold">{formatCurrency(ledger.closingBalance)}</span>
            </div>
          </div>
        )}
      </Card>

      {proximos.length > 0 && (
        <Card className="mt-4">
          <SectionTitle
            title="Próximos lançamentos"
            hint="Previstos para os próximos dias — ainda não afetam o saldo do dia."
          />
          <ul className="divide-y divide-border">
            {proximos.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold">{t.descricao}</span>
                  <span className="block text-xs text-muted-foreground">
                    {formatDate(t.data_movimento)} · {origemDe(t)}
                  </span>
                </span>
                <span className="text-sm font-bold text-muted-foreground">
                  {movementEffect(t) >= 0 ? "+" : "−"}
                  {formatCurrency(Math.abs(movementEffect(t)))}
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}



      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card>
          <SectionTitle title="Entradas do período" />
          {entradasLista.length === 0 ? (
            <p className="text-xs text-muted-foreground">Nenhuma entrada no período.</p>
          ) : (
            <ul className="divide-y divide-border">
              {entradasLista.map((t) => (
                <li key={t.id} className="flex items-center justify-between gap-3 py-2.5">
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold">{t.descricao}</span>
                    <span className="block text-xs text-muted-foreground">
                      {formatDate(t.data_movimento)}
                    </span>
                  </span>
                  <span className="text-sm font-bold">
                    +{formatCurrency(Number(t.valor) || 0)}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card>
          <SectionTitle title="Saídas do período" hint="Como o dinheiro saiu desta conta." />
          <ul className="divide-y divide-border">
            <Linha label="Compras via PIX / débito" valor={saidasPix} />
            <Linha label="Boletos e contas de consumo" valor={saidasBoleto} />
            <Linha label="Pagamentos de cartão" valor={pagamentos} />
            <Linha label="Tarifas, IOF e juros" valor={saidasTarifas} />
            <Linha label="Transferências" valor={transferencias} />
            <Linha label="Outras saídas" valor={saidasOutras} />
          </ul>
        </Card>
      </div>
    </div>
  );
}

/** Último dia do mês de referência (YYYY-MM) em ISO. */
function ultimoDiaDoMes(periodo: string) {
  const [ano, mes] = periodo.split("-").map(Number);
  return new Date(Date.UTC(ano!, mes!, 0)).toISOString().slice(0, 10);
}

function Linha({ label, valor }: { label: string; valor: number }) {

  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-bold">{formatCurrency(valor)}</span>
    </li>
  );
}

/**
 * Só movimentações manuais do ledger podem ser estornadas por aqui.
 * Compras, faturas e aberturas de saldo têm o próprio fluxo de correção.
 */
function podeEstornar(t: Transaction) {
  if (t.purchase_id || t.tipo === "PAGAMENTO_CARTAO" || t.tipo === "ABERTURA_SALDO") return false;
  const manual = (t as { manual?: boolean | null }).manual;
  return Boolean(manual) || t.tipo === "TRANSFERENCIA";
}

/** Opção do zero state da conta recém-cadastrada. */
function ZeroOption({
  titulo,
  descricao,
  onClick,
}: {
  titulo: string;
  descricao: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-border bg-card p-4 text-left transition-colors hover:border-primary/50 hover:bg-muted/50"
    >
      <span className="block text-sm font-semibold">{titulo}</span>
      <span className="mt-1 block text-xs text-muted-foreground">{descricao}</span>
    </button>
  );
}
