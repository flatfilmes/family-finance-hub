import { useEffect, useState } from "react";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, Card, Field, inputClass, PrimaryButton } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useProfile } from "@/hooks/useFamilyData";
import { supabase } from "@/integrations/supabase/client";

export const Route = createFileRoute("/_authenticated/configuracoes")({
  head: () => ({
    meta: [
      { title: "Configurações — Família Finance AI" },
      { name: "description", content: "Atualize seus dados pessoais e gerencie sua conta." },
      { property: "og:title", content: "Configurações — Família Finance AI" },
      { property: "og:description", content: "Dados pessoais e conta no Família Finance AI." },
    ],
  }),
  component: Configuracoes,
});

function Configuracoes() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");

  useEffect(() => {
    if (!profile) return;
    setNome(profile.nome_completo);
    setTelefone(profile.telefone ?? "");
  }, [profile]);

  const save = useMutation({
    mutationFn: async () => {
      const { error } = await supabase
        .from("profiles")
        .update({ nome_completo: nome, telefone: telefone || null })
        .eq("id", user!.id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Dados atualizados.");
      queryClient.invalidateQueries({ queryKey: ["profile", user?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    navigate({ to: "/auth", replace: true });
  }

  return (
    <div>
      <PageHeader title="Configurações" subtitle="Seus dados pessoais e acesso à conta." />

      <Card className="max-w-xl">
        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <Field label="Nome completo">
            <input
              required
              value={nome}
              onChange={(e) => setNome(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="Telefone (opcional)">
            <input
              value={telefone}
              onChange={(e) => setTelefone(e.target.value)}
              className={inputClass}
            />
          </Field>
          <Field label="E-mail">
            <input value={profile?.email ?? user?.email ?? ""} disabled className={inputClass} />
          </Field>
          <PrimaryButton type="submit" disabled={save.isPending}>
            {save.isPending ? "Salvando..." : "Salvar alterações"}
          </PrimaryButton>
        </form>
      </Card>

      <Card className="mt-4 max-w-xl">
        <h2 className="text-base font-bold">Conta</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Encerre sua sessão neste dispositivo.
        </p>
        <button
          onClick={handleSignOut}
          className="mt-4 rounded-full border border-border px-6 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
        >
          Sair da conta
        </button>
      </Card>
    </div>
  );
}
