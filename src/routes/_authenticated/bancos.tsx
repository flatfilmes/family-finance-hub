import { useMemo, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { Card, Field, PageHeader, inputClass } from "@/components/page-header";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { useTransactions } from "@/hooks/useTransactions";
import { usePurchases } from "@/hooks/usePurchases";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { useViewMode, ViewModeSwitch } from "@/components/view-mode";
import { useMemberName } from "@/components/member-select";
import { formatCurrency } from "@/lib/finance";
import { BANK_ACCOUNT_TYPE_LABELS } from "@/lib/bank-accounts";
import { currentMonth, formatDate, monthLabel } from "@/lib/expenses";
import {
  TRANSACTION_STATUS_CLASSES,
  TRANSACTION_STATUS_LABELS,
  type Transaction,
} from "@/lib/transactions";
import type { Purchase } from "@/lib/purchases";
import { NoFamily } from "./receitas";

export const Route = createFileRoute("/_authenticated/bancos")({
  head: () => ({
    meta: [
      { title: "Bancos da Família — Família Finance AI" },
      {
        name: "description",
        content:
          "Visão consolidada das contas bancárias: saldos, entradas, saídas e pagamentos de cartão por pessoa.",
      },
      { property: "og:title", content: "Bancos da Família — Família Finance AI" },
      {
        property: "og:description",
        content: "Saldo total, movimentações e histórico de cada conta bancária da família.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
    ],
  }),
  component: BancosPage,
});

/** Classificação legível da origem de cada movimentação bancária. */
function origemDoMovimento(t: Transaction, compra?: Purchase) {
  if (t.tipo === "PAGAMENTO_CARTAO") return "Pagamento de cartão";
  if (t.tipo === "ENTRADA") return "Entrada";
  if (t.tipo === "TRANSFERENCIA") return "Transferência";
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

function BancosPage() {
  const { data: family } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: accounts, isLoading } = useBankAccounts(family?.id);
  const { data: movimentos } = useTransactions(family?.id);
  const { data: purchases } = usePurchases(family?.id);
  const memberName = useMemberName(family?.id);
  const view = useViewMode();

  const [filtroMembro, setFiltroMembro] = useState("");
  const [filtroBanco, setFiltroBanco] = useState("");
  const [periodo, setPeriodo] = useState(currentMonth());
  const [contaAberta, setContaAberta] = useState<string>("");

  const compraPorId = useMemo(() => {
    const map = new Map<string, Purchase>();
    for (const p of purchases ?? []) map.set(p.id, p);
    return map;
  }, [purchases]);

  if (!family) return <NoFamily />;

  const bancos = Array.from(new Set((accounts ?? []).map((a) => a.banco))).sort();

  const lista = filterByMember(accounts ?? [], view.scoped(filtroMembro)).filter((a) =>
    filtroBanco ? a.banco === filtroBanco : true,
  );

  const idsVisiveis = new Set(lista.map((a) => a.id));
  const movimentosVisiveis = (movimentos ?? []).filter(
    (t) =>
      t.bank_account_id &&
      idsVisiveis.has(t.bank_account_id) &&
      t.status !== "CANCELADA" &&
      (!periodo || t.data_movimento.startsWith(periodo)),
  );

  const soma = (tipo: Transaction["tipo"], rows = movimentosVisiveis) =>
    rows.filter((t) => t.tipo === tipo).reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  const saldoTotal = lista
    .filter((a) => a.ativo)
    .reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);
  const entradas = soma("ENTRADA");
  const saidas = soma("SAIDA");
  const pagamentos = soma("PAGAMENTO_CARTAO");
  const liquido = entradas - saidas - pagamentos;

  const grupos = (members ?? [])
    .map((m) => ({ membro: m, contas: lista.filter((a) => a.member_id === m.id) }))
    .filter((g) => g.contas.length > 0);
  const semTitular = lista.filter((a) => !a.member_id);

  const conta = lista.find((a) => a.id === contaAberta) ?? null;
  const movimentosDaConta = (id: string) =>
    (movimentos ?? [])
      .filter((t) => t.bank_account_id === id && (!periodo || t.data_movimento.startsWith(periodo)))
      .slice(0, 50);

  return (
    <div>
      <PageHeader
        title="Bancos da família"
        subtitle="De onde o dinheiro entrou e saiu. O cadastro de contas continua no perfil de cada pessoa."
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Resumo label="Saldo total em contas" value={formatCurrency(saldoTotal)} destaque />
        <Resumo label="Entradas do período" value={formatCurrency(entradas)} />
        <Resumo label="Saídas do período" value={formatCurrency(saidas)} />
        <Resumo label="Pagamentos de cartão" value={formatCurrency(pagamentos)} />
        <Resumo
          label="Saldo líquido do período"
          value={formatCurrency(liquido)}
          tone={liquido < 0 ? "danger" : "ok"}
        />
      </div>

      <Card className="mt-4">
        <div className="grid gap-4 sm:grid-cols-3">
          {view.isAdmin ? (
            <MemberFilter familyId={family.id} value={filtroMembro} onChange={setFiltroMembro} />
          ) : (
            <div className="flex items-end">
              <ViewModeSwitch mode={view.mode} onChange={view.setMode} canSwitch={false} />
            </div>
          )}
          <Field label="Banco">
            <select
              className={inputClass}
              value={filtroBanco}
              onChange={(e) => setFiltroBanco(e.target.value)}
              aria-label="Banco"
            >
              <option value="">Todos</option>
              {bancos.map((b) => (
                <option key={b} value={b}>
                  {b}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Período">
            <input
              type="month"
              className={inputClass}
              value={periodo}
              onChange={(e) => setPeriodo(e.target.value)}
            />
          </Field>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Movimentações de {periodo ? monthLabel(periodo) : "todo o histórico"}. Os valores vêm das
          movimentações confirmadas — cada compra entra uma única vez.
        </p>
      </Card>

      {isLoading ? (
        <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
      ) : lista.length === 0 ? (
        <Card className="mt-4">
          <p className="text-sm text-muted-foreground">
            Nenhuma conta bancária encontrada. Abra o perfil de uma pessoa em Minha Família e
            adicione a conta na aba “Contas bancárias”.
          </p>
        </Card>
      ) : (
        <div className="mt-4 grid gap-4">
          {grupos.map(({ membro, contas }) => (
            <Card key={membro.id}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-base font-bold">{membro.nome}</h2>
                <Link
                  to="/membro/$memberId"
                  params={{ memberId: membro.id }}
                  className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
                >
                  Ver perfil financeiro
                </Link>
              </div>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {contas.map((a) => (
                  <ContaCard
                    key={a.id}
                    banco={a.banco}
                    nome={a.nome_conta}
                    tipo={BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]}
                    ativo={a.ativo}
                    saldo={Number(a.saldo_atual) || 0}
                    onClick={() => setContaAberta(a.id)}
                  />
                ))}
              </div>
            </Card>
          ))}

          {semTitular.length > 0 && (
            <Card>
              <h2 className="text-base font-bold">Contas da família (sem titular)</h2>
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                {semTitular.map((a) => (
                  <ContaCard
                    key={a.id}
                    banco={a.banco}
                    nome={a.nome_conta}
                    tipo={BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]}
                    ativo={a.ativo}
                    saldo={Number(a.saldo_atual) || 0}
                    onClick={() => setContaAberta(a.id)}
                  />
                ))}
              </div>
            </Card>
          )}
        </div>
      )}

      {conta && (
        <Modal onClose={() => setContaAberta("")} title={`${conta.banco} · ${conta.nome_conta}`}>
          <DetalheConta
            titular={memberName(conta.member_id)}
            saldo={Number(conta.saldo_atual) || 0}
            movimentos={movimentosDaConta(conta.id)}
            periodo={periodo}
            compraPorId={compraPorId}
          />
        </Modal>
      )}
    </div>
  );
}

function ContaCard({
  banco,
  nome,
  tipo,
  ativo,
  saldo,
  onClick,
}: {
  banco: string;
  nome: string;
  tipo: string;
  ativo: boolean;
  saldo: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="rounded-2xl border border-border p-4 text-left transition-colors hover:bg-muted/60"
    >
      <p className="truncate text-sm font-bold">
        {banco} · {nome}
      </p>
      <p className="text-xs text-muted-foreground">
        {tipo}
        {ativo ? "" : " · inativa"}
      </p>
      <p className="mt-2 text-xl font-extrabold">{formatCurrency(saldo)}</p>
      <span className="mt-2 inline-block text-xs font-semibold text-primary">Ver movimentações</span>
    </button>
  );
}

function DetalheConta({
  titular,
  saldo,
  movimentos,
  periodo,
  compraPorId,
}: {
  titular: string;
  saldo: number;
  movimentos: Transaction[];
  periodo: string;
  compraPorId: Map<string, Purchase>;
}) {
  const validas = movimentos.filter((t) => t.status !== "CANCELADA");
  const soma = (tipo: Transaction["tipo"]) =>
    validas.filter((t) => t.tipo === tipo).reduce((acc, t) => acc + (Number(t.valor) || 0), 0);
  const entradas = soma("ENTRADA");
  const saidas = soma("SAIDA");
  const pagamentos = soma("PAGAMENTO_CARTAO");
  const projetado = saldo + entradas - saidas - pagamentos;

  return (
    <div>
      <p className="text-xs text-muted-foreground">
        Titular: {titular} · período {periodo ? monthLabel(periodo) : "completo"}
      </p>

      <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Resumo label="Saldo atual" value={formatCurrency(saldo)} destaque />
        <Resumo label="Entradas no período" value={formatCurrency(entradas)} />
        <Resumo label="Saídas no período" value={formatCurrency(saidas + pagamentos)} />
        <Resumo
          label="Saldo projetado"
          value={formatCurrency(projetado)}
          tone={projetado < 0 ? "danger" : "ok"}
        />
      </div>

      <h3 className="mt-5 text-sm font-bold">Histórico de movimentações</h3>
      {movimentos.length === 0 ? (
        <p className="mt-2 text-xs text-muted-foreground">Nenhuma movimentação no período.</p>
      ) : (
        <ul className="mt-2 divide-y divide-border">
          {movimentos.map((t) => {
            const compra = t.purchase_id ? compraPorId.get(t.purchase_id) : undefined;
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-3 py-2.5">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{t.descricao}</p>
                  <p className="text-xs text-muted-foreground">
                    {formatDate(t.data_movimento)} · {origemDoMovimento(t, compra)}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${TRANSACTION_STATUS_CLASSES[t.status]}`}
                  >
                    {TRANSACTION_STATUS_LABELS[t.status]}
                  </span>
                  <span className="text-sm font-bold">
                    {t.tipo === "ENTRADA" ? "+" : "-"}
                    {formatCurrency(Number(t.valor) || 0)}
                  </span>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function Resumo({
  label,
  value,
  tone,
  destaque,
}: {
  label: string;
  value: string;
  tone?: "ok" | "danger";
  destaque?: boolean;
}) {
  return (
    <div className="rounded-2xl border border-border bg-card px-4 py-3">
      <p className="text-xs font-semibold text-muted-foreground">{label}</p>
      <p
        className={`mt-1 font-extrabold ${destaque ? "text-xl" : "text-lg"} ${
          tone === "danger" ? "text-destructive" : ""
        }`}
      >
        {value}
      </p>
    </div>
  );
}

export function Modal({
  title,
  onClose,
  children,
}: {
  title: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-foreground/40 p-0 backdrop-blur-sm sm:items-center sm:p-6">
      <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-t-3xl border border-border bg-card p-6 shadow-card sm:rounded-3xl">
        <div className="flex items-start justify-between gap-4">
          <h2 className="text-lg font-extrabold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground hover:bg-muted"
          >
            Fechar
          </button>
        </div>
        <div className="mt-4">{children}</div>
      </div>
    </div>
  );
}
