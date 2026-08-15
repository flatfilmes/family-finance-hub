import { useState } from "react";
import { createFileRoute } from "@tanstack/react-router";
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

      <Card>
        <h2 className="text-base font-bold">Membros</h2>
        <ul className="mt-4 divide-y divide-border">
          {(members ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center gap-3 py-3">
              <div className="min-w-56 flex-1">
                <p className="text-sm font-semibold">{m.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {m.relacionamento || "Sem relacionamento definido"} ·{" "}
                  {MEMBER_PROFILE_LABELS[perfilDe(m.id)]}
                </p>
                <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
                  <span>
                    Receitas:{" "}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(resumo(m.id).receitas)}
                    </span>
                  </span>
                  <span>
                    Cartões:{" "}
                    <span className="font-semibold text-foreground">{resumo(m.id).cartoes}</span>
                  </span>
                  <span>
                    Gastos do mês:{" "}
                    <span className="font-semibold text-foreground">
                      {formatCurrency(resumo(m.id).gastos)}
                    </span>
                  </span>
                </div>
                {isAdmin && (
                  <div className="mt-2">
                    <select
                      aria-label={`Perfil financeiro de ${m.nome}`}
                      value={perfilDe(m.id)}
                      onChange={(e) =>
                        updateProfile.mutate({
                          memberId: m.id,
                          tipo: e.target.value as MemberProfileType,
                        })
                      }
                      className="rounded-xl border border-input bg-background px-3 py-2 text-xs font-medium"
                    >
                      {MEMBER_PROFILE_TYPES.map((t) => (
                        <option key={t} value={t}>
                          {MEMBER_PROFILE_LABELS[t]}
                        </option>
                      ))}
                    </select>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {MEMBER_PROFILE_DESCRIPTIONS[perfilDe(m.id)]}
                    </p>
                  </div>
                )}
              </div>
              {isAdmin ? (
                <select
                  value={m.permissao}
                  onChange={(e) =>
                    updatePermission.mutate({ id: m.id, value: e.target.value as FamilyPermission })
                  }
                  className="rounded-xl border border-input bg-background px-3 py-2 text-xs font-medium"
                >
                  {PERMISSOES.map((p) => (
                    <option key={p} value={p}>
                      {PERMISSION_LABELS[p]}
                    </option>
                  ))}
                </select>
              ) : (
                <span className="rounded-full bg-muted px-3 py-1.5 text-xs font-medium text-muted-foreground">
                  {PERMISSION_LABELS[m.permissao]}
                </span>
              )}
              {isAdmin && m.user_id !== family.owner_id && (
                <button
                  aria-label={`Remover ${m.nome}`}
                  onClick={() => removeMemberMutation.mutate(m.id)}
                  className="rounded-lg p-2 text-muted-foreground transition-colors hover:bg-muted hover:text-destructive"
                >
                  <Trash2 className="size-4" />
                </button>
              )}
            </li>
          ))}
        </ul>
      </Card>

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
