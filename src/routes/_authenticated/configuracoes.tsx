import { useEffect, useState } from "react";
import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { PageHeader, Card, Field, inputClass, PrimaryButton } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily, useProfile } from "@/hooks/useFamilyData";
import { useFinancialSettings } from "@/hooks/useFinancialEngine";
import { DEFAULT_SETTINGS, saveFinancialSettings } from "@/lib/financial-engine";
import { useDeleteDemoData, useDemoMode } from "@/hooks/useDemoMode";
import { DEMO_DELETE_CONFIRMATION } from "@/lib/demo";
import { supabase } from "@/integrations/supabase/client";
import { DocumentLibraryCard } from "@/components/document-library";

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
      <PageHeader
        title="Configurações"
        subtitle="Central de cadastro e administração: família, estrutura financeira e sistema."
      />

      <div className="mb-5 flex flex-wrap gap-2">
        {SECOES.map((s) => (
          <button
            key={s}
            onClick={() => setSecao(s)}
            className={
              s === secao
                ? "rounded-full bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground"
                : "rounded-full border border-border px-4 py-2 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted"
            }
          >
            {s}
          </button>
        ))}
      </div>

      {secao === "Família e membros" && (
        <>
          <FamilyAdmin />
          <Card className="mt-4">
            <h2 className="text-base font-bold">Perfis e permissões</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              O perfil financeiro (Administrador familiar, Membro, Dependente, Visualizador) e a
              permissão de acesso de cada pessoa são definidos dentro de “Gerenciar perfil” →
              Dados pessoais.
            </p>
          </Card>
        </>
      )}

      {secao === "Estrutura financeira" && (
        <>
          <Card>
            <h2 className="text-base font-bold">Receitas, contas e cartões</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Cada receita, conta bancária e cartão pertence a uma pessoa. O cadastro é feito no
              perfil do membro; o uso (movimentação, fatura e análise) fica nas páginas Bancos,
              Cartões e Dashboard.
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              {(members ?? []).map((m) => (
                <Link
                  key={m.id}
                  to="/membro/$memberId"
                  params={{ memberId: m.id }}
                  className="rounded-2xl border border-border px-4 py-3 transition-colors hover:bg-muted"
                >
                  <p className="text-sm font-bold">{m.nome}</p>
                  <p className="text-xs text-muted-foreground">
                    Receitas · Contas bancárias · Cartões
                  </p>
                </Link>
              ))}
              {(members ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">
                  Cadastre membros em “Família e membros”.
                </p>
              )}
            </div>
          </Card>

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
        </>
      )}

      {secao === "Sistema" && (
        <>
          <Card className="max-w-xl">
            <h2 className="text-base font-bold">Preferências pessoais</h2>
            <form
              className="mt-4 space-y-4"
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

          <DemoModeCard />

          <DocumentLibraryCard />

          <Card className="mt-4 max-w-xl">
            <h2 className="text-base font-bold">Segurança e conta</h2>
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
        </>
      )}
    </div>
  );
}


function DemoModeCard() {
  const { ativo, activeFamily, demoFamilies, isLoading } = useDemoMode();
  const remove = useDeleteDemoData();

  function handleDelete() {
    if (!window.confirm(DEMO_DELETE_CONFIRMATION)) return;
    remove.mutate(undefined, {
      onSuccess: (qtd) =>
        toast.success(
          qtd > 0
            ? `Dados de demonstração removidos (${qtd} família${qtd > 1 ? "s" : ""}).`
            : "Nenhum dado de demonstração para remover.",
        ),
      onError: (e: Error) => toast.error(e.message),
    });
  }

  return (
    <Card className="mt-4 max-w-xl">
      <h2 className="text-base font-bold">Modo Demonstração</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        Ambiente separado, usado apenas para testes e apresentação. Não se mistura com seus dados
        reais.
      </p>

      <dl className="mt-4 space-y-3 text-sm">
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Status</dt>
          <dd>
            <span
              className={`rounded-full px-3 py-1 text-xs font-semibold ${
                ativo
                  ? "bg-amber-500/15 text-amber-700 dark:text-amber-400"
                  : "bg-muted text-muted-foreground"
              }`}
            >
              {isLoading ? "Carregando..." : ativo ? "Ativo" : "Inativo"}
            </span>
          </dd>
        </div>
        <div className="flex items-center justify-between gap-4">
          <dt className="text-muted-foreground">Família demonstrativa atual</dt>
          <dd className="font-semibold">{activeFamily?.nome_da_familia ?? "Nenhuma"}</dd>
        </div>
        {demoFamilies.length > 1 && (
          <div className="flex items-center justify-between gap-4">
            <dt className="text-muted-foreground">Famílias demo cadastradas</dt>
            <dd className="font-semibold">{demoFamilies.length}</dd>
          </div>
        )}
      </dl>

      <button
        onClick={handleDelete}
        disabled={!ativo || remove.isPending}
        className="mt-4 rounded-full border border-destructive/40 px-6 py-2.5 text-sm font-semibold text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {remove.isPending ? "Excluindo..." : "Excluir dados de demonstração"}
      </button>
      <p className="mt-2 text-xs text-muted-foreground">{DEMO_DELETE_CONFIRMATION}</p>
    </Card>
  );
}
