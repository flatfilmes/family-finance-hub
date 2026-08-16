import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { CurrencyInput } from "@/components/ui/currency-input";
import { FormActions } from "@/components/form-dialog";
import { useAuth } from "@/hooks/useAuth";
import { useMembers } from "@/hooks/useFamilyData";
import { createCreditCard, updateCreditCard, type CreditCard } from "@/lib/finance";

const clampDay = (v: string) => Math.min(31, Math.max(1, Number(v) || 1));

/** Cadastro e edição de cartão de crédito dentro do perfil financeiro de um membro. */
export function CreditCardForm({
  familyId,
  memberId,
  card,
  onSaved,
  onCancel,
}: {
  familyId: string;
  memberId: string;
  /** Quando informado, o formulário edita o cartão existente. */
  card?: CreditCard;
  /** Chamado após salvar — usado para fechar o diálogo de cadastro. */
  onSaved?: () => void;
  /** Quando informado, o formulário usa o rodapé padrão Salvar / Cancelar. */
  onCancel?: () => void;
}) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: members } = useMembers(familyId);
  const [banco, setBanco] = useState(card?.banco ?? "");
  const [nomeCartao, setNomeCartao] = useState(card?.nome_cartao ?? "");
  const [limite, setLimite] = useState<number | null>(card ? Number(card.limite) : null);
  const [fechamento, setFechamento] = useState(String(card?.dia_fechamento ?? 1));
  const [vencimento, setVencimento] = useState(String(card?.dia_vencimento ?? 10));
  const [titular, setTitular] = useState(card?.member_id ?? memberId);

  const save = useMutation({
    mutationFn: async () => {
      if (card) {
        await updateCreditCard(card.id, {
          banco: banco.trim(),
          nome_cartao: nomeCartao.trim(),
          limite: limite ?? 0,
          dia_fechamento: clampDay(fechamento),
          dia_vencimento: clampDay(vencimento),
          member_id: titular || null,
        });
        return;
      }
      await createCreditCard({
        family_id: familyId,
        created_by: user?.id ?? null,
        banco: banco.trim(),
        nome_cartao: nomeCartao.trim(),
        limite: limite ?? 0,
        dia_fechamento: clampDay(fechamento),
        dia_vencimento: clampDay(vencimento),
        member_id: titular || memberId,
      });
    },
    onSuccess: () => {
      if (!card) {
        setBanco("");
        setNomeCartao("");
        setLimite(null);
      }
      toast.success(card ? "Cartão atualizado." : "Cartão cadastrado.");
      onSaved?.();
      queryClient.invalidateQueries({ queryKey: ["credit-cards", familyId] });
      queryClient.invalidateQueries({ queryKey: ["card-invoices", familyId] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  return (
    <form
      className="grid gap-4 sm:grid-cols-2"
      onSubmit={(e) => {
        e.preventDefault();
        if (!banco.trim() || !nomeCartao.trim()) {
          toast.error("Informe o banco e o nome do cartão.");
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
          placeholder="Nubank, Itaú..."
        />
      </Field>
      <Field label="Nome do cartão">
        <input
          className={inputClass}
          value={nomeCartao}
          onChange={(e) => setNomeCartao(e.target.value)}
          placeholder="Cartão principal"
        />
      </Field>
      <Field label="Limite">
        <CurrencyInput value={limite} onChange={setLimite} />
      </Field>
      <Field label="Titular">
        <select className={inputClass} value={titular} onChange={(e) => setTitular(e.target.value)}>
          {(members ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.nome}
            </option>
          ))}
        </select>
      </Field>
      <div className="grid grid-cols-2 gap-4 sm:col-span-2">
        <Field label="Dia de fechamento">
          <input
            className={inputClass}
            value={fechamento}
            onChange={(e) => setFechamento(e.target.value)}
            inputMode="numeric"
          />
        </Field>
        <Field label="Dia de vencimento">
          <input
            className={inputClass}
            value={vencimento}
            onChange={(e) => setVencimento(e.target.value)}
            inputMode="numeric"
          />
        </Field>
      </div>
      {card && (
        <p className="sm:col-span-2 text-xs text-muted-foreground">
          Alterações de limite, fechamento e vencimento valem para os ciclos atuais e futuros.
          Faturas já fechadas permanecem como estão.
        </p>
      )}
      {onCancel ? (
        <div className="sm:col-span-2">
          <FormActions
            onCancel={onCancel}
            saving={save.isPending}
            saveLabel={card ? "Salvar alterações" : "Salvar cartão"}
          />
        </div>
      ) : (
        <div className="flex items-end">
          <PrimaryButton type="submit" disabled={save.isPending}>
            <span className="inline-flex items-center gap-1.5">
              <Plus className="size-4" />
              {save.isPending ? "Salvando..." : "Adicionar cartão"}
            </span>
          </PrimaryButton>
        </div>
      )}
    </form>
  );
}
