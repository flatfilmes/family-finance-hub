import { useState } from "react";
import { createFileRoute, Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2 } from "lucide-react";
import { PageHeader, Card, Field, inputClass, PrimaryButton } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily, useMembers, useProfile } from "@/hooks/useFamilyData";
import { supabase } from "@/integrations/supabase/client";
import { useIncomes, useCreditCards } from "@/hooks/useFinanceData";
import { useExpenses } from "@/hooks/useExpenses";
import { useMemberProfiles } from "@/hooks/useMemberProfiles";
import { currentMonth } from "@/lib/expenses";
import { formatCurrency, monthlyIncomeValue } from "@/lib/finance";
import {
  MEMBER_PROFILE_DESCRIPTIONS,
  MEMBER_PROFILE_LABELS,
  MEMBER_PROFILE_TYPES,
  upsertMemberProfile,
  type MemberProfileType,
} from "@/lib/member-profiles";
import {
  createFamily,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LABELS,
  type FamilyPermission,
} from "@/lib/family";

export const Route = createFileRoute("/_authenticated/minha-familia")({
  head: () => ({
    meta: [
      { title: "Minha Família — Família Finance AI" },
      { name: "description", content: "Crie sua família e defina as permissões de cada membro." },
      { property: "og:title", content: "Minha Família — Família Finance AI" },
      { property: "og:description", content: "Gerencie os membros e permissões da sua família." },
    ],
  }),
  component: MinhaFamilia,
});

const PERMISSOES: FamilyPermission[] = ["ADMIN", "MEMBER", "VIEWER"];

function MinhaFamilia() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { data: family, isLoading } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: profiles } = useMemberProfiles(family?.id);
  const { data: incomes } = useIncomes(family?.id);
  const { data: cards } = useCreditCards(family?.id);
  const { data: monthExpenses } = useExpenses(family?.id, { month: currentMonth() });

  const [nomeFamilia, setNomeFamilia] = useState("");
  const [novoNome, setNovoNome] = useState("");
  const [relacionamento, setRelacionamento] = useState("");
  const [permissao, setPermissao] = useState<FamilyPermission>("MEMBER");

  const isAdmin =
    !!family &&
    (family.owner_id === user?.id ||
      members?.some((m) => m.user_id === user?.id && m.permissao === "ADMIN"));

  const createFamilyMutation = useMutation({
    mutationFn: () =>
      createFamily({
        nome: nomeFamilia.trim(),
        ownerId: user!.id,
        ownerNome: profile?.nome_completo || "Responsável",
      }),
    onSuccess: () => {
      toast.success("Família criada!");
      setNomeFamilia("");
      queryClient.invalidateQueries();
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const addMemberMutation = useMutation({
    mutationFn: async () => {
      const { error } = await supabase.from("family_members").insert({
        family_id: family!.id,
        nome: novoNome.trim(),
        relacionamento: relacionamento.trim() || null,
        permissao,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membro adicionado.");
      setNovoNome("");
      setRelacionamento("");
      setPermissao("MEMBER");
      queryClient.invalidateQueries({ queryKey: ["members", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const removeMemberMutation = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("family_members").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => {
      toast.success("Membro removido.");
      queryClient.invalidateQueries({ queryKey: ["members", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updateProfile = useMutation({
    mutationFn: ({ memberId, tipo }: { memberId: string; tipo: MemberProfileType }) =>
      upsertMemberProfile({
        familyId: family!.id,
        familyMemberId: memberId,
        tipoPerfil: tipo,
        podeLancarDespesas: tipo === "ADMIN_FAMILIAR" || tipo === "MEMBRO",
        podeVerPropriosDados: tipo !== "VISUALIZADOR",
      }),
    onSuccess: () => {
      toast.success("Perfil financeiro atualizado.");
      queryClient.invalidateQueries({ queryKey: ["member-profiles", family?.id] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const updatePermission = useMutation({
    mutationFn: async ({ id, value }: { id: string; value: FamilyPermission }) => {
      const { error } = await supabase.from("family_members").update({ permissao: value }).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["members", family?.id] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const perfilDe = (memberId: string): MemberProfileType =>
    profiles?.find((p) => p.family_member_id === memberId)?.tipo_perfil ?? "MEMBRO";

  const resumo = (memberId: string) => ({
    receitas: (incomes ?? [])
      .filter((i) => i.member_id === memberId && i.ativo)
      .reduce((acc, i) => acc + monthlyIncomeValue(i), 0),
    cartoes: (cards ?? []).filter((c) => c.member_id === memberId).length,
    contas: (accounts ?? []).filter((a) => a.member_id === memberId).length,
    gastos: (monthExpenses ?? [])
      .filter((e) => e.member_id === memberId)
      .reduce((acc, e) => acc + (Number(e.valor) || 0), 0),
  });


  if (isLoading) {
    return <p className="text-sm text-muted-foreground">Carregando...</p>;
  }

  if (!family) {
    return (
      <div>
        <PageHeader
          title="Minha Família"
          subtitle="Crie sua família para começar a organizar as finanças em conjunto."
        />
        <Card className="max-w-lg">
          <form
            className="space-y-4"
            onSubmit={(e) => {
              e.preventDefault();
              createFamilyMutation.mutate();
            }}
          >
            <Field label="Nome da família">
              <input
                required
                value={nomeFamilia}
                onChange={(e) => setNomeFamilia(e.target.value)}
                className={inputClass}
                placeholder="Família Souza"
              />
            </Field>
            <PrimaryButton type="submit" disabled={createFamilyMutation.isPending}>
              {createFamilyMutation.isPending ? "Criando..." : "Criar família"}
            </PrimaryButton>
          </form>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader
        title={family.nome_da_familia}
        subtitle="Defina quem participa e o nível de acesso de cada pessoa."
      />

      <div className="grid gap-4 sm:grid-cols-2">
        {(members ?? []).map((m) => {
          const r = resumo(m.id);
          return (
            <Card key={m.id}>
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-lg font-bold">{m.nome}</p>
                  <p className="text-xs font-semibold text-primary">
                    {MEMBER_PROFILE_LABELS[perfilDe(m.id)]}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {m.relacionamento || "Sem relacionamento definido"}
                  </p>
                </div>
                {isAdmin && m.user_id !== family.owner_id && (
                  <button
                    aria-label={`Remover ${m.nome}`}
                    onClick={() => removeMemberMutation.mutate(m.id)}
                    className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                  >
                    <Trash2 className="size-4" />
                  </button>
                )}
              </div>

              <dl className="mt-4 grid grid-cols-2 gap-3">
                <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
                  <dt className="text-[11px] font-semibold text-muted-foreground">Receitas</dt>
                  <dd className="text-sm font-bold">{formatCurrency(r.receitas)}</dd>
                </div>
                <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
                  <dt className="text-[11px] font-semibold text-muted-foreground">Gastos do mês</dt>
                  <dd className="text-sm font-bold">{formatCurrency(r.gastos)}</dd>
                </div>
                <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
                  <dt className="text-[11px] font-semibold text-muted-foreground">Cartões</dt>
                  <dd className="text-sm font-bold">{r.cartoes}</dd>
                </div>
                <div className="rounded-2xl bg-muted/60 px-3 py-2.5">
                  <dt className="text-[11px] font-semibold text-muted-foreground">Contas</dt>
                  <dd className="text-sm font-bold">{r.contas}</dd>
                </div>
              </dl>

              <Link
                to="/membro/$memberId"
                params={{ memberId: m.id }}
                className="mt-4 inline-flex w-full items-center justify-center rounded-full bg-primary px-5 py-2.5 text-sm font-semibold text-primary-foreground shadow-soft transition-colors hover:bg-primary/90"
              >
                Ver perfil financeiro
              </Link>

              {isAdmin && (
                <div className="mt-4 grid gap-3 border-t border-border pt-4 sm:grid-cols-2">
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                      Perfil financeiro
                    </span>
                    <select
                      aria-label={`Perfil financeiro de ${m.nome}`}
                      value={perfilDe(m.id)}
                      onChange={(e) =>
                        updateProfile.mutate({
                          memberId: m.id,
                          tipo: e.target.value as MemberProfileType,
                        })
                      }
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs font-medium"
                    >
                      {MEMBER_PROFILE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {MEMBER_PROFILE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="block">
                    <span className="mb-1.5 block text-[11px] font-semibold text-muted-foreground">
                      Permissão
                    </span>
                    <select
                      value={m.permissao}
                      aria-label={`Permissão de ${m.nome}`}
                      onChange={(e) =>
                        updatePermission.mutate({
                          id: m.id,
                          value: e.target.value as FamilyPermission,
                        })
                      }
                      className="w-full rounded-xl border border-input bg-background px-3 py-2 text-xs font-medium"
                    >
                      {PERMISSOES.map((p) => (
                        <option key={p} value={p}>
                          {PERMISSION_LABELS[p]}
                        </option>
                      ))}
                    </select>
                  </label>
                  <p className="text-xs text-muted-foreground sm:col-span-2">
                    {MEMBER_PROFILE_DESCRIPTIONS[perfilDe(m.id)]}
                  </p>
                </div>
              )}
            </Card>
          );
        })}
        {(members ?? []).length === 0 && (
          <Card>
            <p className="text-sm text-muted-foreground">
              Nenhuma pessoa cadastrada ainda. Adicione os membros da família abaixo para começar.
            </p>
          </Card>
        )}
      </div>


      {isAdmin && (
        <Card className="mt-4">
          <h2 className="text-base font-bold">Adicionar membro</h2>
          <form
            className="mt-4 grid gap-4 sm:grid-cols-3"
            onSubmit={(e) => {
              e.preventDefault();
              addMemberMutation.mutate();
            }}
          >
            <Field label="Nome">
              <input
                required
                value={novoNome}
                onChange={(e) => setNovoNome(e.target.value)}
                className={inputClass}
                placeholder="João Souza"
              />
            </Field>
            <Field label="Relacionamento">
              <input
                value={relacionamento}
                onChange={(e) => setRelacionamento(e.target.value)}
                className={inputClass}
                placeholder="Filho, cônjuge..."
              />
            </Field>
            <Field label="Permissão">
              <select
                value={permissao}
                onChange={(e) => setPermissao(e.target.value as FamilyPermission)}
                className={inputClass}
              >
                {PERMISSOES.map((p) => (
                  <option key={p} value={p}>
                    {PERMISSION_LABELS[p]}
                  </option>
                ))}
              </select>
            </Field>
            <div className="sm:col-span-3">
              <p className="mb-3 text-xs text-muted-foreground">
                {PERMISSION_DESCRIPTIONS[permissao]}
              </p>
              <PrimaryButton type="submit" disabled={addMemberMutation.isPending}>
                {addMemberMutation.isPending ? "Adicionando..." : "Adicionar membro"}
              </PrimaryButton>
            </div>
          </form>
        </Card>
      )}
    </div>
  );
}
