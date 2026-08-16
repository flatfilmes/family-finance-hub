import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { FormActions } from "@/components/form-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useMembers } from "@/hooks/useFamilyData";
import {
  BANK_ACCOUNT_TYPES,
  BANK_ACCOUNT_TYPE_LABELS,
  createBankAccount,
  updateBankAccount,
  type BankAccount,
  type BankAccountType,
} from "@/lib/bank-accounts";
import { formatCurrency } from "@/lib/finance";

/** Cadastro e edição de conta bancária dentro do perfil financeiro de um membro. */
export function BankAccountForm({
  familyId,
  memberId,
  account,
  onSaved,
  onCancel,
}: {
  familyId: string;
  memberId: string;
  /** Quando informado, o formulário edita a conta existente. */
  account?: BankAccount;
  /** Chamado após salvar — usado para fechar o diálogo de cadastro. */
  onSaved?: () => void;
  /** Quando informado, o formulário usa o rodapé padrão Salvar / Cancelar. */
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: members } = useMembers(familyId);
  const [banco, setBanco] = useState(account?.banco ?? "");
  const [nomeConta, setNomeConta] = useState(account?.nome_conta ?? "");
  const [tipo, setTipo] = useState<BankAccountType>(account?.tipo_conta ?? "CORRENTE");
  const [titular, setTitular] = useState(account?.member_id ?? memberId);

  const save = useMutation({
    mutationFn: async () => {
      if (account) {
        await updateBankAccount(account.id, {
          banco: banco.trim(),
          nome_conta: nomeConta.trim(),
          tipo_conta: tipo,
          member_id: titular || null,
        });
        return;
      }
      await createBankAccount({
        family_id: familyId,
        created_by: user?.id ?? null,
        member_id: titular || memberId,
        banco: banco.trim(),
        nome_conta: nomeConta.trim(),
        tipo_conta: tipo,
        // O cadastro é estrutural: a posição financeira nasce em Bancos,
        // por saldo informado, extrato ou print — sempre auditável.
        saldo_atual: 0,
      });
    },
    onSuccess: () => {
      if (!account) {
        setBanco("");
        setNomeConta("");
      }
      toast.success(account ? "Conta atualizada." : "Conta bancária cadastrada.");
      onSaved?.();
      queryClient.invalidateQueries({ queryKey: ["bank-accounts", familyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!banco.trim() || !nomeConta.trim()) {
          toast.error("Informe o banco e o nome da conta.");
          return;
        }
        save.mutate();
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
      <Field label="Titular">
        <select
          className={inputClass}
          value={titular}
          onChange={(e) => setTitular(e.target.value)}
        >
          {(members ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </Field>
      {account ? (
        <div className="sm:col-span-2 rounded-2xl bg-muted/60 p-4">
          <p className="text-xs font-semibold text-muted-foreground">Saldo atual calculado</p>
          <p className="mt-1 text-lg font-bold">{formatCurrency(Number(account.saldo_atual))}</p>
          <p className="mt-1 text-xs text-muted-foreground">
            O saldo é controlado pelas movimentações. Para informar ou corrigir a posição da conta,
            use a página Bancos — todo ajuste gera um lançamento auditável.
          </p>
        </div>
      ) : (
        <p className="sm:col-span-2 rounded-2xl bg-primary/5 p-4 text-xs text-muted-foreground">
          O cadastro guarda apenas os dados da conta. Depois de salvar, abra a conta em
          <strong> Bancos</strong> para informar o saldo atual, importar o extrato ou enviar um
          print.
        </p>
      )}
      {onCancel ? (
        <div className="sm:col-span-2">
          <FormActions
            onCancel={onCancel}
            saving={save.isPending}
            saveLabel={account ? "Salvar alterações" : "Salvar conta"}
          />
        </div>
      ) : (
        <div className="flex items-end">
          <PrimaryButton type="submit" disabled={save.isPending}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="size-4" />
              {save.isPending ? "Salvando..." : "Adicionar conta"}
            </span>
          </PrimaryButton>
        </div>
      )}
    </form>
  );
}
