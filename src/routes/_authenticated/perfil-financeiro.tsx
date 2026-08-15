import { useEffect, useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, Card, Field, inputClass, PrimaryButton } from "@/components/page-header";
import { useFamily, useFinancialProfile } from "@/hooks/useFamilyData";
import { supabase } from "@/integrations/supabase/client";
import { GOAL_LABELS, type FinancialGoal } from "@/lib/family";

export const Route = createFileRoute("/_authenticated/perfil-financeiro")({
  head: () => ({
    meta: [
      { title: "Perfil Financeiro — Família Finance AI" },
      { name: "description", content: "Registre renda, dependentes e o objetivo financeiro da família." },
      { property: "og:title", content: "Perfil Financeiro — Família Finance AI" },
      { property: "og:description", content: "Informações financeiras básicas da sua família." },
    ],
  }),
  component: PerfilFinanceiro,
});

const GOALS = Object.keys(GOAL_LABELS) as FinancialGoal[];

function PerfilFinanceiro() {
  const queryClient = useQueryClient();
  const { data: family, isLoading } = useFamily();
  const { data: financial } = useFinancialProfile(family?.id);

  const [dependentes, setDependentes] = useState("0");
  const [objetivo, setObjetivo] = useState<FinancialGoal>("organizar_financas");
  const [renda, setRenda] = useState("0");
  const [rendaVariavel, setRendaVariavel] = useState(false);

  useEffect(() => {
    if (!financial) return;
    setDependentes(String(financial.quantidade_dependentes));
    setObjetivo(financial.objetivo_principal ?? "organizar_financas");
    setRenda(String(financial.renda_principal));
    setRendaVariavel(financial.possui_renda_variavel);
  }, [financial]);

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        family_id: family!.id,
        quantidade_dependentes: Number(dependentes) || 0,
        objetivo_principal: objetivo,
        renda_principal: Number(renda) || 0,
        possui_renda_variavel: rendaVariavel,
      };
      const { error } = await supabase
        .from("financial_profiles")
        .upsert(payload, { onConflict: "family_id" });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Perfil financeiro salvo.");
      queryClient.invalidateQueries({ queryKey: ["financial-profile", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!family) {
    return (
      <div>
        <PageHeader
          title="Perfil Financeiro"
          subtitle="Antes de preencher o perfil financeiro, crie sua família."
        />
        <Link to="/minha-familia" className="text-sm font-semibold text-primary">
          Criar minha família →
        </Link>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title="Perfil Financeiro"
        subtitle="Informações básicas que servirão de base para as futuras análises inteligentes."
      />
      <Card className="max-w-2xl">
        <form
          className="grid gap-5 sm:grid-cols-2"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Quantidade de dependentes">
            <input
              type="number"
              min={0}
              value={dependentes}
              onChange={(e) => setDependentes(e.target.value)}
              className={inputClass}
            />
          </Field>

          <Field label="Renda principal (R$)">
            <input
              type="number"
              min={0}
              step="0.01"
              value={renda}
              onChange={(e) => setRenda(e.target.value)}
              className={inputClass}
            />
          </Field>

          <div className="sm:col-span-2">
            <span className="mb-2 block text-xs font-semibold text-muted-foreground">
              Objetivo principal
            </span>
            <div className="grid gap-2 sm:grid-cols-2">
              {GOALS.map((g) => (
                <button
                  type="button"
                  key={g}
                  onClick={() => setObjetivo(g)}
                  className={`rounded-2xl border px-4 py-3 text-left text-sm font-medium transition-colors ${
                    objetivo === g
                      ? "border-primary bg-accent text-accent-foreground"
                      : "border-border bg-background text-muted-foreground hover:bg-muted"
                  }`}
                >
                  {GOAL_LABELS[g]}
                </button>
              ))}
            </div>
          </div>

          <label className="flex items-center gap-3 sm:col-span-2">
            <input
              type="checkbox"
              checked={rendaVariavel}
              onChange={(e) => setRendaVariavel(e.target.checked)}
              className="size-4 accent-primary"
            />
            <span className="text-sm">A família possui renda variável</span>
          </label>

          <div className="sm:col-span-2">
            <PrimaryButton type="submit" disabled={save.isPending}>
              {save.isPending ? "Salvando..." : "Salvar perfil financeiro"}
            </PrimaryButton>
          </div>
        </form>
      </Card>
    </div>
  );
}
