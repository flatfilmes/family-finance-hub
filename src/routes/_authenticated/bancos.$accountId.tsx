import { useMemo, useState } from "react";
import { Receipt } from "lucide-react";
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
import { NoFamily } from "./receitas";

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

const ORIGENS = [
  "Entrada",
  "PIX",
  "Débito",
  "Boleto",
  "Transferência",
  "Pagamento de cartão",
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

  // O saldo atual já é atualizado pelas movimentações; aqui apenas as apresentamos.
  const doPeriodo = (movimentos ?? []).filter(
    (t) =>
      t.bank_account_id === conta.id &&
      t.status !== "CANCELADA" &&
      (!periodo || t.data_movimento.startsWith(periodo)),
  );

  const soma = (tipo: Transaction["tipo"], rows = doPeriodo) =>
    rows.filter((t) => t.tipo === tipo).reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  const entradas = soma("ENTRADA");
  const saidas = soma("SAIDA");
  const pagamentos = soma("PAGAMENTO_CARTAO");
  const transferencias = soma("TRANSFERENCIA");
  const resultado = entradas - saidas - pagamentos;

  const origemDe = (t: Transaction) =>
    origemDoMovimento(t, t.purchase_id ? compraPorId.get(t.purchase_id) : undefined);

  const filtrados = doPeriodo.filter(
    (t) =>
      (!filtroOrigem || origemDe(t) === filtroOrigem) &&
      matchesSearch(busca, t.descricao),
  );

  const somaPorOrigem = (origem: string, tipos: Transaction["tipo"][]) =>
    doPeriodo
      .filter((t) => tipos.includes(t.tipo) && origemDe(t) === origem)
      .reduce((acc, t) => acc + (Number(t.valor) || 0), 0);

  const saidasPix = somaPorOrigem("PIX", ["SAIDA"]) + somaPorOrigem("Débito", ["SAIDA"]);
  const saidasBoleto = somaPorOrigem("Boleto", ["SAIDA"]);
  const saidasOutras = saidas - saidasPix - saidasBoleto;

  const entradasLista = doPeriodo.filter((t) => t.tipo === "ENTRADA");

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
          conta.member_id ? (
            <Link
              to="/membro/$memberId"
              params={{ memberId: conta.member_id }}
              className="rounded-full border border-border px-4 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:bg-muted"
            >
              Ver perfil do titular
            </Link>
          ) : null
        }
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-5">
        <Metric label="Saldo atual" value={formatCurrency(Number(conta.saldo_atual) || 0)} big />
        <Metric label="Entradas do período" value={formatCurrency(entradas)} />
        <Metric label="Saídas do período" value={formatCurrency(saidas)} />
        <Metric label="Pagamentos de cartão" value={formatCurrency(pagamentos)} />
        <Metric
          label="Saldo líquido do período"
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
        <SectionTitle title="Movimentações" />
        {filtrados.length === 0 ? (
          <EmptyState
            icon={<Receipt className="size-5" />}
            title="Nenhuma movimentação no período"
            description="Entradas, compras no PIX/débito e pagamentos de fatura desta conta aparecem aqui."
          />
        ) : (
          <div className="-mx-2 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <thead>
                <tr className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                  <th className="px-2 py-2">Data</th>
                  <th className="px-2 py-2">Descrição</th>
                  <th className="px-2 py-2">Tipo</th>
                  <th className="px-2 py-2">Origem</th>
                  <th className="px-2 py-2 text-right">Valor</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {filtrados.map((t) => (
                  <tr key={t.id}>
                    <td className="whitespace-nowrap px-2 py-2.5 text-muted-foreground">
                      {formatDate(t.data_movimento)}
                    </td>
                    <td className="px-2 py-2.5">
                      <span className="block font-semibold">{t.descricao}</span>
                      {t.tipo === "TRANSFERENCIA" && (
                        <span className="block text-[11px] text-muted-foreground">
                          Origem: {conta.banco} · {conta.nome_conta} — transferência interna, não é
                          gasto da família
                        </span>
                      )}
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">
                      {t.tipo === "ENTRADA"
                        ? "Entrada"
                        : t.tipo === "PAGAMENTO_CARTAO"
                          ? "Pagamento de cartão"
                          : t.tipo === "TRANSFERENCIA"
                            ? "Transferência"
                            : "Saída"}
                    </td>
                    <td className="px-2 py-2.5 text-muted-foreground">{origemDe(t)}</td>
                    <td className="whitespace-nowrap px-2 py-2.5 text-right">
                      <span className="font-bold">
                        {t.tipo === "ENTRADA" ? "+" : "-"}
                        {formatCurrency(Number(t.valor) || 0)}
                      </span>
                      <span
                        className={`ml-2 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold ${TRANSACTION_STATUS_CLASSES[t.status]}`}
                      >
                        {TRANSACTION_STATUS_LABELS[t.status]}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

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
            <Linha label="Boletos" valor={saidasBoleto} />
            <Linha label="Pagamentos de cartão" valor={pagamentos} />
            <Linha label="Transferências" valor={transferencias} />
            <Linha label="Outras saídas" valor={saidasOutras} />
          </ul>
        </Card>
      </div>
    </div>
  );
}

function Linha({ label, valor }: { label: string; valor: number }) {
  return (
    <li className="flex items-center justify-between gap-3 py-2.5">
      <span className="text-sm text-muted-foreground">{label}</span>
      <span className="text-sm font-bold">{formatCurrency(valor)}</span>
    </li>
  );
}
