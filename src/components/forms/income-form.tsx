import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FormActions } from "@/components/form-dialog";
import { useAuth } from "@/hooks/useAuth";
import {
  INCOME_FREQUENCY_LABELS,
  INCOME_TYPE_LABELS,
  createIncome,
  updateIncome,
  type Income,
  type IncomeFrequency,
  type IncomeType,
} from "@/lib/finance";

/** Cadastro e edição de receita dentro do perfil financeiro de um membro. */
export function IncomeForm({
  familyId,
  memberId,
  income,
  onSaved,
  onCancel,
}: {
  familyId: string;
  memberId: string;
  /** Quando informado, o formulário edita a receita existente. */
  income?: Income;
  /** Chamado após salvar — usado para fechar o diálogo de cadastro. */
  onSaved?: () => void;
  /** Quando informado, o formulário usa o rodapé padrão Salvar / Cancelar. */
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [descricao, setDescricao] = useState(income?.descricao ?? "");
  const [valor, setValor] = useState<number | null>(income ? Number(income.valor) : null);
  const [tipo, setTipo] = useState<IncomeType>(income?.tipo ?? "FIXA");
  const [frequencia, setFrequencia] = useState<IncomeFrequency>(income?.frequencia ?? "MENSAL");
  const [diaRecebimento, setDiaRecebimento] = useState(String(income?.dia_recebimento ?? 5));

  const save = useMutation({
    mutationFn: async () => {
      const dia = frequencia === "MENSAL" ? Number(diaRecebimento) : null;
      if (income) {
        await updateIncome(income.id, {
          descricao: descricao.trim(),
          valor: valor ?? 0,
          tipo,
          frequencia,
          dia_recebimento: dia,
        });
        return;
      }
      await createIncome({
        family_id: familyId,
        created_by: user?.id ?? null,
        descricao: descricao.trim(),
        valor: valor ?? 0,
        tipo,
        frequencia,
        dia_recebimento: dia,
        data_recebimento: null,
        member_id: memberId,
      });
    },
    onSuccess: () => {
      if (!income) {
        setDescricao("");
        setValor(null);
        setDiaRecebimento("5");
      }
      toast.success(income ? "Receita atualizada." : "Receita cadastrada.");
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
        if (!valor || valor <= 0) {
          toast.error("Informe um valor maior que zero.");
          return;
        }
        if (frequencia === "MENSAL") {
          const dia = Number(diaRecebimento);
          if (!Number.isInteger(dia) || dia < 1 || dia > 31) {
            toast.error("O dia do recebimento deve ser entre 1 e 31.");
            return;
          }
        }
        save.mutate();
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
      <Field label="Valor">
        <CurrencyInput value={valor} onChange={setValor} />
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
      {frequencia === "MENSAL" && (
        <Field label="Dia do recebimento">
          <select
            className={inputClass}
            value={diaRecebimento}
            onChange={(e) => setDiaRecebimento(e.target.value)}
          >
            {Array.from({ length: 31 }, (_, idx) => idx + 1).map((d) => (
              <option key={d} value={d}>
                Todo dia {d}
              </option>
            ))}
          </select>
        </Field>
      )}
      {onCancel ? (
        <div className="sm:col-span-2">
          <FormActions
            onCancel={onCancel}
            saving={save.isPending}
            saveLabel={income ? "Salvar alterações" : "Salvar receita"}
          />
        </div>
      ) : (
        <div className="flex items-end">
          <PrimaryButton type="submit" disabled={save.isPending}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="size-4" />
              {save.isPending ? "Salvando..." : "Adicionar receita"}
            </span>
          </PrimaryButton>
        </div>
      )}
    </form>
  );
}
