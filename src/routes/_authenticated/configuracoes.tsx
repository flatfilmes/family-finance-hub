import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, Card, Field, inputClass, PrimaryButton } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily, useProfile } from "@/hooks/useFamilyData";
import { useFinancialSettings } from "@/hooks/useFinancialEngine";
import { DEFAULT_SETTINGS, saveFinancialSettings } from "@/lib/financial-engine";
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

  const { data: family } = useFamily();
  const { data: settings } = useFinancialSettings(family?.id);

  const [nome, setNome] = useState("");
  const [telefone, setTelefone] = useState("");
  const [reserva, setReserva] = useState(String(DEFAULT_SETTINGS.percentual_reserva));
  const [alertaCartao, setAlertaCartao] = useState(String(DEFAULT_SETTINGS.limite_alerta_cartao));

  useEffect(() => {
    if (!settings) return;
    setReserva(String(settings.percentual_reserva));
    setAlertaCartao(String(settings.limite_alerta_cartao));
  }, [settings]);

  const saveSettings = useMutation({
    mutationFn: () =>
      saveFinancialSettings({
        familyId: family!.id,
        percentualReserva: Number(reserva) || 0,
        limiteAlertaCartao: Number(alertaCartao) || 0,
      }),
    onSuccess: () => {
      toast.success("Parâmetros financeiros salvos.");
      queryClient.invalidateQueries({ queryKey: ["financial-settings", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

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

      {family && (
        <Card className="mt-4 max-w-xl">
          <h2 className="text-base font-bold">Parâmetros financeiros</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Usados pelo cálculo de quanto a família pode gastar.
          </p>
          <form
            className="mt-4 space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              saveSettings.mutate();
            }}
          >
            <Field label="Percentual de reserva (%)">
              <input
                required
                type="number"
                min={0}
                max={100}
                step="1"
                value={reserva}
                onChange={(e) => setReserva(e.target.value)}
                className={inputClass}
              />
            </Field>
            <Field label="Limite de alerta do cartão (% do limite)">
              <input
                required
                type="number"
                min={0}
                max={100}
                step="1"
                value={alertaCartao}
                onChange={(e) => setAlertaCartao(e.target.value)}
                className={inputClass}
              />
            </Field>
            <PrimaryButton type="submit" disabled={saveSettings.isPending}>
              {saveSettings.isPending ? "Salvando..." : "Salvar parâmetros"}
            </PrimaryButton>
          </form>
        </Card>
      )}

      <Card className="mt-4 max-w-xl">
        <h2 className="text-base font-bold">Cadastros da família</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Perfil financeiro da família e contas fixas compartilhadas.
        </p>
        <div className="mt-4 flex flex-wrap gap-3">
          <Link
            to="/perfil-financeiro"
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
          >
            Perfil financeiro
          </Link>
          <Link
            to="/contas-fixas"
            className="rounded-full border border-border px-5 py-2.5 text-sm font-semibold transition-colors hover:bg-muted"
          >
            Contas fixas
          </Link>
        </div>
      </Card>

      <DemoModeCard />

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
