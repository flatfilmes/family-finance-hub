import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { FormActions } from "@/components/form-dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  BANK_ACCOUNT_TYPES,
  BANK_ACCOUNT_TYPE_LABELS,
  createBankAccount,
  type BankAccountType,
} from "@/lib/bank-accounts";

/** Cadastro de conta bancária dentro do perfil financeiro de um membro. */
export function BankAccountForm({
  familyId,
  memberId,
  onSaved,
  onCancel,
}: {
  familyId: string;
  memberId: string;
  /** Chamado após salvar — usado para fechar o diálogo de cadastro. */
  onSaved?: () => void;
  /** Quando informado, o formulário usa o rodapé padrão Salvar / Cancelar. */
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [banco, setBanco] = useState("");
  const [nomeConta, setNomeConta] = useState("");
  const [tipo, setTipo] = useState<BankAccountType>("CORRENTE");
  const [saldo, setSaldo] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createBankAccount({
        family_id: familyId,
        created_by: user?.id ?? null,
        member_id: memberId,
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
      {onCancel ? (
        <div className="sm:col-span-2">
          <FormActions onCancel={onCancel} saving={create.isPending} saveLabel="Salvar conta" />
        </div>
      ) : (
        <div className="flex items-end">
          <PrimaryButton type="submit" disabled={create.isPending}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="size-4" />
              {create.isPending ? "Salvando..." : "Adicionar conta"}
            </span>
          </PrimaryButton>
        </div>
      )}
    </form>
  );
}
