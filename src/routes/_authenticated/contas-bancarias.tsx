import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Trash2 } from "lucide-react";
import { Card, Field, PageHeader, PrimaryButton, inputClass } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily } from "@/hooks/useFamilyData";
import { useBankAccounts } from "@/hooks/useBankAccounts";
import { MemberSelect, useMemberName } from "@/components/member-select";
import { MemberFilter, filterByMember } from "@/components/member-filter";
import { formatCurrency } from "@/lib/finance";
import { NoFamily } from "./receitas";
import {
  BANK_ACCOUNT_TYPES,
  BANK_ACCOUNT_TYPE_LABELS,
  createBankAccount,
  deleteBankAccount,
  toggleBankAccount,
  type BankAccountType,
} from "@/lib/bank-accounts";

export const Route = createFileRoute("/_authenticated/contas-bancarias")({
  head: () => ({
    meta: [
      { title: "Contas Bancárias — Família Finance AI" },
      {
        name: "description",
        content: "Cadastre as contas bancárias de cada membro da família e acompanhe os saldos.",
      },
      { property: "og:title", content: "Contas Bancárias — Família Finance AI" },
      {
        property: "og:description",
        content: "Contas bancárias individuais com visão consolidada da família.",
      },
    ],
  }),
  component: ContasBancariasPage,
});

function ContasBancariasPage() {
  const { user } = useAuth();
  const { data: family } = useFamily();
  const { data: accounts, isLoading } = useBankAccounts(family?.id);
  const queryClient = useQueryClient();
  const memberName = useMemberName(family?.id);

  const [banco, setBanco] = useState("");
  const [nomeConta, setNomeConta] = useState("");
  const [tipo, setTipo] = useState<BankAccountType>("CORRENTE");
  const [saldo, setSaldo] = useState("");
  const [memberId, setMemberId] = useState("");
  const [filtroMembro, setFiltroMembro] = useState("");

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["bank-accounts", family?.id] });

  const create = useMutation({
    mutationFn: () =>
      createBankAccount({
        family_id: family!.id,
        created_by: user?.id ?? null,
        member_id: memberId || null,
        banco: banco.trim(),
        nome_conta: nomeConta.trim(),
        tipo_conta: tipo,
        saldo_atual: Number(saldo.replace(",", ".")) || 0,
      }),
    onSuccess: () => {
      setBanco("");
      setNomeConta("");
      setSaldo("");
      toast.success("Conta bancária cadastrada.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const remove = useMutation({
    mutationFn: (id: string) => deleteBankAccount(id),
    onSuccess: () => {
      toast.success("Conta removida.");
      invalidate();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const toggle = useMutation({
    mutationFn: ({ id, ativo }: { id: string; ativo: boolean }) => toggleBankAccount(id, ativo),
    onSuccess: invalidate,
    onError: (e: Error) => toast.error(e.message),
  });

  if (!family) return <NoFamily />;

  const lista = filterByMember(accounts ?? [], filtroMembro);
  const saldoTotal = lista.filter((a) => a.ativo).reduce((acc, a) => acc + (Number(a.saldo_atual) || 0), 0);

  return (
    <div>
      <PageHeader
        title="Contas Bancárias"
        subtitle="Cada conta pertence a uma pessoa da família. A visão consolidada soma tudo."
      />

      <Card>
        <h2 className="text-base font-bold">Nova conta</h2>
        <form
          className="mt-5 grid gap-4 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (!banco.trim() || !nomeConta.trim()) {
              toast.error("Informe o banco e o nome da conta.");
              return;
            }
            if (!memberId) {
              toast.error("Selecione o titular da conta.");
              return;
            }
            create.mutate();
          }}
        >
          <Field label="Banco">
            <input
              className={inputClass}
              value={banco}
              onChange={(e) => setBanco(e.target.value)}
              placeholder="Nubank, Itaú, Santander..."
            />
          </Field>
          <Field label="Nome da conta">
            <input
              className={inputClass}
              value={nomeConta}
              onChange={(e) => setNomeConta(e.target.value)}
              placeholder="Conta principal"
            />
          </Field>
          <Field label="Tipo de conta">
            <select
              className={inputClass}
              value={tipo}
              onChange={(e) => setTipo(e.target.value as BankAccountType)}
            >
              {BANK_ACCOUNT_TYPES.map((t) => (
                <option key={t} value={t}>
                  {BANK_ACCOUNT_TYPE_LABELS[t]}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Saldo atual (R$)">
            <input
              className={inputClass}
              value={saldo}
              onChange={(e) => setSaldo(e.target.value)}
              inputMode="decimal"
              placeholder="0,00"
            />
          </Field>
          <MemberSelect
            familyId={family.id}
            value={memberId}
            onChange={setMemberId}
            label="Titular"
          />
          <div className="flex items-end">
            <PrimaryButton type="submit" disabled={create.isPending}>
              <span className="inline-flex items-center gap-1.5">
                <Plus className="size-4" />
                {create.isPending ? "Salvando..." : "Adicionar conta"}
              </span>
            </PrimaryButton>
          </div>
        </form>
      </Card>

      <Card className="mt-4">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <h2 className="text-base font-bold">Contas cadastradas</h2>
          <div className="w-48">
            <MemberFilter familyId={family.id} value={filtroMembro} onChange={setFiltroMembro} />
          </div>
        </div>
        <p className="mt-2 text-sm text-muted-foreground">
          Saldo somado das contas ativas:{" "}
          <span className="font-semibold text-foreground">{formatCurrency(saldoTotal)}</span>
        </p>

        {isLoading ? (
          <p className="mt-4 text-sm text-muted-foreground">Carregando...</p>
        ) : lista.length ? (
          <ul className="mt-4 divide-y divide-border">
            {lista.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-4 py-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">
                    {a.banco} · {a.nome_conta}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {BANK_ACCOUNT_TYPE_LABELS[a.tipo_conta]} · {memberName(a.member_id)}
                    {!a.ativo && " · inativa"}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-sm font-semibold">{formatCurrency(Number(a.saldo_atual))}</span>
                  <button
                    onClick={() => toggle.mutate({ id: a.id, ativo: !a.ativo })}
                    className="rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
                  >
                    {a.ativo ? "Desativar" : "Ativar"}
                  </button>
                  <button
                    aria-label={`Remover ${a.nome_conta}`}
                    onClick={() => remove.mutate(a.id)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-4 text-sm text-muted-foreground">
            Nenhuma conta bancária cadastrada ainda. Comece adicionando a conta principal de cada
            pessoa da família.
          </p>
        )}
      </Card>
    </div>
  );
}
