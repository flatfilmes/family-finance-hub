import { useAuth } from "@/hooks/useAuth";
import { useFamily, useMembers } from "@/hooks/useFamilyData";
import { useMemberProfiles } from "@/hooks/useMemberProfiles";
import type { MemberProfileType } from "@/lib/member-profiles";

export type ViewMode = "familia" | "minha";

/**
 * Permissões financeiras da pessoa logada dentro da família ativa.
 * ADMIN_FAMILIAR vê tudo e pode alternar entre visão da família e visão individual.
 * MEMBRO / DEPENDENTE / VISUALIZADOR ficam sempre restritos aos próprios dados.
 */
export function usePermissions() {
  const { user } = useAuth();
  const { data: family } = useFamily();
  const { data: members, isLoading: loadingMembers } = useMembers(family?.id);
  const { data: profiles, isLoading: loadingProfiles } = useMemberProfiles(family?.id);

  const me = (members ?? []).find((m) => m.user_id === user?.id) ?? null;
  const perfil = (profiles ?? []).find((p) => p.family_member_id === me?.id) ?? null;

  const tipo: MemberProfileType = perfil?.tipo_perfil
    ? perfil.tipo_perfil
    : me?.permissao === "ADMIN"
      ? "ADMIN_FAMILIAR"
      : me?.permissao === "VIEWER"
        ? "VISUALIZADOR"
        : "MEMBRO";

  const isOwner = !!family && !!user && family.owner_id === user.id;
  const isAdmin = isOwner || tipo === "ADMIN_FAMILIAR" || me?.permissao === "ADMIN";
  const isViewer = tipo === "VISUALIZADOR" || me?.permissao === "VIEWER";
  const podeLancar = !isViewer && (perfil ? perfil.pode_lancar_despesas : true);

  return {
    isLoading: loadingMembers || loadingProfiles,
    me,
    myMemberId: me?.id ?? "",
    tipo,
    isAdmin,
    isViewer,
    podeLancar,
    /** Só o administrador familiar pode alternar entre Família e Minha. */
    canSwitchView: isAdmin,
  };
}

/**
 * Converte o modo de visualização + filtro de pessoa em um `member_id` efetivo.
 * Para quem não é administrador, o escopo é sempre o próprio membro.
 */
export function scopeMemberId(input: {
  isAdmin: boolean;
  myMemberId: string;
  mode: ViewMode;
  filtroMembro?: string;
}) {
  if (!input.isAdmin) return input.myMemberId;
  if (input.mode === "minha") return input.myMemberId;
  return input.filtroMembro ?? "";
}
