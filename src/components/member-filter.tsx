import { useMembers } from "@/hooks/useFamilyData";
import { Field, inputClass } from "@/components/page-header";

type Props = {
  familyId?: string | undefined;
  value: string;
  onChange: (value: string) => void;
  label?: string;
};

/** Filtro "Pessoa" para as visões consolidadas da família. */
export function MemberFilter({ familyId, value, onChange, label = "Pessoa" }: Props) {
  const { data: members } = useMembers(familyId);
  return (
    <Field label={label}>
      <select
        className={inputClass}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={label}
      >
        <option value="">Todos</option>
        {(members ?? []).map((m) => (
          <option key={m.id} value={m.id}>
            {m.nome}
          </option>
        ))}
        <option value="sem">Sem responsável</option>
      </select>
    </Field>
  );
}

/** Aplica o filtro de pessoa a uma lista com member_id. */
export function filterByMember<T extends { member_id: string | null }>(rows: T[], value: string) {
  if (!value) return rows;
  if (value === "sem") return rows.filter((r) => !r.member_id);
  return rows.filter((r) => r.member_id === value);
}
