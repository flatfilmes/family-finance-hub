import { Search, X } from "lucide-react";

/** Busca textual padrão das listagens (Compras, Bancos, Cartões). */
export function SearchInput({
  value,
  onChange,
  placeholder = "Buscar...",
  label = "Buscar",
}: {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  label?: string;
}) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-semibold text-muted-foreground">{label}</span>
      <span className="relative block">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label}
          className="w-full rounded-xl border border-input bg-background py-2.5 pl-10 pr-10 text-sm outline-none transition focus:border-ring focus:ring-2 focus:ring-ring/25"
        />
        {value && (
          <button
            type="button"
            onClick={() => onChange("")}
            aria-label="Limpar busca"
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-full p-1.5 text-muted-foreground transition-colors hover:bg-muted"
          >
            <X className="size-4" />
          </button>
        )}
      </span>
    </label>
  );
}

/** Normaliza texto para busca (sem acento, minúsculo). */
export function normalize(value: string) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/** Verifica se algum dos campos contém o termo buscado. */
export function matchesSearch(term: string, ...fields: (string | null | undefined)[]) {
  const q = normalize(term);
  if (!q) return true;
  return fields.some((f) => (f ? normalize(f).includes(q) : false));
}
