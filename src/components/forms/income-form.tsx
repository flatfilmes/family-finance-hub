import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { FormActions } from "@/components/form-dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  INCOME_FREQUENCY_LABELS,
  INCOME_TYPE_LABELS,
  createIncome,
  type IncomeFrequency,
  type IncomeType,
} from "@/lib/finance";

/** Cadastro de receita dentro do perfil financeiro de um membro. */
export function IncomeForm({
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
  const [descricao, setDescricao] = useState("");
  const [valor, setValor] = useState("");
  const [tipo, setTipo] = useState<IncomeType>("FIXA");
  const [frequencia, setFrequencia] = useState<IncomeFrequency>("MENSAL");
  const [dataRecebimento, setDataRecebimento] = useState("");

  const create = useMutation({
    mutationFn: () =>
      createIncome({
        family_id: familyId,
        created_by: user?.id ?? null,
        descricao: descricao.trim(),
        valor: Number(valor.replace(",", ".")) || 0,
        tipo,
        frequencia,
        data_recebimento: dataRecebimento || null,
        member_id: memberId,
      }),
    onSuccess: () => {
      setDescricao("");
      setValor("");
      setDataRecebimento("");
      toast.success("Receita cadastrada.");
      onSaved?.();
      queryClient.invalidateQueries({ queryKey: ["incomes", familyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!descricao.trim()) {
          toast.error("Informe a descrição.");
          return;
        }
        create.mutate();
      }}
    >
      <Field label="Descrição">
        <input
          className={inputClass}
          value={descricao}
          onChange={(e) => setDescricao(e.target.value)}
          placeholder="Salário, comissão, renda extra..."
        />
      </Field>
      <Field label="Valor (R$)">
        <input
          className={inputClass}
          value={valor}
          onChange={(e) => setValor(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
        />
      </Field>
      <Field label="Tipo">
        <select
          className={inputClass}
          value={tipo}
          onChange={(e) => setTipo(e.target.value as IncomeType)}
        >
          {Object.entries(INCOME_TYPE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Frequência">
        <select
          className={inputClass}
          value={frequencia}
          onChange={(e) => setFrequencia(e.target.value as IncomeFrequency)}
        >
          {Object.entries(INCOME_FREQUENCY_LABELS).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
      </Field>
      <Field label="Data de recebimento">
        <input
          type="date"
          className={inputClass}
          value={dataRecebimento}
          onChange={(e) => setDataRecebimento(e.target.value)}
        />
      </Field>
      {onCancel ? (
        <div className="sm:col-span-2">
          <FormActions onCancel={onCancel} saving={create.isPending} saveLabel="Salvar receita" />
        </div>
      ) : (
        <div className="flex items-end">
          <PrimaryButton type="submit" disabled={create.isPending}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="size-4" />
              {create.isPending ? "Salvando..." : "Adicionar receita"}
            </span>
          </PrimaryButton>
        </div>
      )}
    </form>
  );
}
