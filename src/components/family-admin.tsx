import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Trash2, ArrowRight } from "lucide-react";
import { Card, Field, inputClass, PrimaryButton } from "@/components/page-header";
import { useAuth } from "@/hooks/useAuth";
import { useFamily, useMembers, useProfile } from "@/hooks/useFamilyData";
import { useMemberProfiles } from "@/hooks/useMemberProfiles";
import { supabase } from "@/integrations/supabase/client";
import { MEMBER_PROFILE_LABELS, type MemberProfileType } from "@/lib/member-profiles";
import {
  createFamily,
  PERMISSION_DESCRIPTIONS,
  PERMISSION_LABELS,
  type FamilyPermission,
} from "@/lib/family";

const PERMISSOES: FamilyPermission[] = ["ADMIN", "MEMBER", "VIEWER"];

/**
 * Área cadastral da família dentro de Configurações.
 * Mostra apenas identificação do membro — nenhum dado financeiro,
 * que pertence ao Dashboard e às páginas operacionais.
 */
export function FamilyAdmin() {
  const { user } = useAuth();
  const queryClient = useQueryClient();
  const { data: profile } = useProfile();
  const { data: family, isLoading } = useFamily();
  const { data: members } = useMembers(family?.id);
  const { data: profiles } = useMemberProfiles(family?.id);

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

  const perfilDe = (memberId: string): MemberProfileType =>
    profiles?.find((p) => p.family_member_id === memberId)?.tipo_perfil ?? "MEMBRO";

  if (isLoading) return <p className="text-sm text-muted-foreground">Carregando...</p>;

  if (!family) {
    return (
      <Card className="max-w-lg">
        <h2 className="text-base font-bold">Criar minha família</h2>
        <p className="mb-4 mt-1 text-sm text-muted-foreground">
          A família é o espaço compartilhado onde membros, contas e cartões são cadastrados.
        </p>
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
    );
  }

  return (
    <div>
      <Card>
        <h2 className="text-base font-bold">{family.nome_da_familia}</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          Cadastro das pessoas da família. Receitas, contas e cartões de cada pessoa ficam dentro de
          “Gerenciar perfil”. Análises financeiras ficam no Dashboard.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          {(members ?? []).map((m) => (
            <div
              key={m.id}
              className="flex items-center justify-between gap-3 rounded-2xl border border-border px-4 py-3"
            >
              <div className="min-w-0">
                <p className="truncate text-sm font-bold">{m.nome}</p>
                <p className="text-xs text-muted-foreground">
                  {MEMBER_PROFILE_LABELS[perfilDe(m.id)]}
                  {m.relacionamento ? ` · ${m.relacionamento}` : ""}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-1">
                <Link
                  to="/membro/$memberId"
                  params={{ memberId: m.id }}
                  className="inline-flex items-center gap-1 rounded-full border border-border px-3.5 py-1.5 text-xs font-semibold transition-colors hover:bg-muted"
                >
                  Gerenciar perfil
                  <ArrowRight className="size-3.5" />
                </Link>
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
            </div>
          ))}
          {(members ?? []).length === 0 && (
            <p className="text-sm text-muted-foreground">
              Nenhuma pessoa cadastrada ainda. Adicione os membros abaixo.
            </p>
          )}
        </div>
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

export { PERMISSOES };
