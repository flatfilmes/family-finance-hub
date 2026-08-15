import { Field, inputClass } from "@/components/page-header";
import { useMembers } from "@/hooks/useFamilyData";

type Props = {
  familyId?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  label?: string;
};

/** Seleção do membro responsável por um registro financeiro (opcional). */
export function MemberSelect({ familyId, value, onChange, label = "Responsável" }: Props) {
  const { data: members } = useMembers(familyId);
  return (
    <Field label={label}>
      <select className={inputClass} value={value} onChange={(e) => onChange(e.target.value)}>
        <option value="">Família (sem responsável)</option>
        {(members ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.nome}
          </option>
        ))}
      </select>
    </Field>
  );
}

/** Nome do membro responsável, para exibição em listas. */
export function useMemberName(familyId?: string) {
  const { data: members } = useMembers(familyId);
  return (memberId: string | null) =>
    members?.find((m) => m.id === memberId)?.nome ?? "Família";
}
