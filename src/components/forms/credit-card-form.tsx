import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus } from "lucide-react";
import { Field, PrimaryButton, inputClass } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { createCreditCard } from "@/lib/finance";

const clampDay = (v: string) => Math.min(31, Math.max(1, Number(v) || 1));

/** Cadastro de cartão de crédito dentro do perfil financeiro de um membro. */
export function CreditCardForm({ familyId, memberId }: { familyId: string; memberId: string }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const [banco, setBanco] = useState("");
  const [nomeCartao, setNomeCartao] = useState("");
  const [limite, setLimite] = useState("");
  const [fechamento, setFechamento] = useState("1");
  const [vencimento, setVencimento] = useState("10");

  const create = useMutation({
    mutationFn: () =>
      createCreditCard({
        family_id: familyId,
        created_by: user?.id ?? null,
        banco: banco.trim(),
        nome_cartao: nomeCartao.trim(),
        limite: Number(limite.replace(",", ".")) || 0,
        dia_fechamento: clampDay(fechamento),
        dia_vencimento: clampDay(vencimento),
        member_id: memberId,
      }),
    onSuccess: () => {
      setBanco("");
      setNomeCartao("");
      setLimite("");
      toast.success("Cartão cadastrado.");
      queryClient.invalidateQueries({ queryKey: ["credit-cards", familyId] });
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
        create.mutate();
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
      <Field label="Limite (R$)">
        <input
          className={inputClass}
          value={limite}
          onChange={(e) => setLimite(e.target.value)}
          inputMode="decimal"
          placeholder="0,00"
        />
      </Field>
      <div className="grid grid-cols-2 gap-4">
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
      <div className="flex items-end">
        <PrimaryButton type="submit" disabled={create.isPending}>
          <span className="inline-flex items-center gap-1.5">
            <Plus className="size-4" />
            {create.isPending ? "Salvando..." : "Adicionar cartão"}
          </span>
        </PrimaryButton>
      </div>
    </form>
  );
}
